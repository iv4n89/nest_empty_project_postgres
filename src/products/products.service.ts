import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PaginatinoDTO } from 'src/common/dtos/pagination.dto';
import { DataSource, Repository } from 'typeorm';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';
import { validate as isUUID } from 'uuid';
import { ProductImage } from './entities';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger('ProductService');

  constructor(
    @InjectRepository(Product)
    private readonly productRespository: Repository<Product>,
    @InjectRepository(ProductImage)
    private readonly productImageRepository: Repository<ProductImage>,
    private readonly dataSource: DataSource,
  ) {}

  async create(createProductDto: CreateProductDto) {
    try {
      const { images = [], ...productDetails } = createProductDto;

      const product = this.productRespository.create({
        ...productDetails,
        images: images.map((image) =>
          this.productImageRepository.create({ url: image }),
        ),
      });
      await this.productRespository.save(product);

      return { ...product, images };
    } catch (err) {
      this.logger.error(err);
      throw new InternalServerErrorException('Error al crear producto');
    }
  }

  async findAll({ limit = 10, offset = 0 }: PaginatinoDTO) {
    const products = await this.productRespository.find({
      take: limit,
      skip: offset,
      relations: {
        images: true,
      },
    });

    return products.map(({ images, ...product }) => ({
      ...product,
      images: images.map(({ url }) => url),
    }));
  }

  async findOne(term: string) {
    try {
      let product;

      if (isUUID(term)) {
        product = await this.productRespository.findOneBy({ id: term });
      } else {
        const queryBuilder = this.productRespository.createQueryBuilder('prod');
        product = await queryBuilder
          .where('UPPER(title) =:title or slug =:slug', {
            title: term.toUpperCase(),
            slug: term.toLowerCase(),
          })
          .leftJoinAndSelect('prod.images', 'prodImages')
          .getOne();
      }

      if (!product) {
        throw new NotFoundException('Producto no encontrado');
      }

      return product;
    } catch (error) {
      this.logger.error(error.message);
      throw error;
    }
  }

  async update(id: string, { images, ...updateProductDto }: UpdateProductDto) {
    const product = await this.productRespository.preload({
      id,
      ...updateProductDto,
    });

    if (!product)
      throw new NotFoundException(`Producto con id ${id} no encontrado`);

    //Create query runner
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (images) {
        await queryRunner.manager.delete(ProductImage, { product: { id } });
        product.images = images.map((image) =>
          this.productImageRepository.create({ url: image }),
        );
      }

      await queryRunner.manager.save(product);

      await queryRunner.commitTransaction();
      await queryRunner.release();

      // await this.productRespository.save(product);
    } catch (error) {
      this.logger.error(error);
      await queryRunner.rollbackTransaction();
      throw new ConflictException('Duplicate key');
    }

    return this.findOnePlain(id);
  }

  async remove(id: string) {
    try {
      const product = await this.findOne(id);
      if (!product) throw new NotFoundException('Producto no existe');
      await this.productRespository.remove(product);
    } catch (err) {
      this.logger.error('Error al borrar');
      throw err;
    }
  }

  async findOnePlain(term: string) {
    const { images = [], ...rest } = await this.findOne(term);

    return {
      ...rest,
      images: images.map((img) => img.url),
    };
  }

  async deleteAllProducts() {
    const query = this.productRespository.createQueryBuilder('product');
    try {
      return await query.delete()
        .where({})
        .execute();
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }
}
