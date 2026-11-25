import { IsNull, Not } from "typeorm";
import AppDataSource from "../configs/database";
import { Product } from "../entities/product.entity";
import AppError from "../utils/appError";
import { isUniqueViolation } from "../utils/dbErrors";

export const productToJSON = (p: Product) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  color: p.color,
  talkingPoints: p.talkingPoints,
  sortOrder: p.sortOrder,
  createdBy: p.createdBy,
  updatedBy: p.updatedBy,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  archivedAt: p.archivedAt
});

// Product names are shown in capitals everywhere in the frontend (NUPI, IRIS, MANDI).
const normaliseName = (name: string) => name.trim().toUpperCase();

export const listProducts = () =>
  Product.find({ where: { archivedAt: IsNull() }, order: { sortOrder: "ASC", createdAt: "ASC" } });

export const findActiveProduct = async (id: string) => {
  const product = await Product.findOneBy({ id, archivedAt: IsNull() });
  if (!product) throw new AppError(404, "Product not found");
  return product;
};

const nameTaken = async (name: string, exceptId?: string) => {
  const qb = Product.createQueryBuilder("p")
    .where("LOWER(p.name) = LOWER(:name)", { name })
    .andWhere("p.archivedAt IS NULL");
  if (exceptId) qb.andWhere("p.id <> :exceptId", { exceptId });
  return (await qb.getCount()) > 0;
};

const nextSortOrder = async () => {
  const row = await Product.createQueryBuilder("p")
    .select("COALESCE(MAX(p.sortOrder), -1)", "max")
    .where("p.archivedAt IS NULL")
    .getRawOne<{ max: number }>();
  return Number(row?.max ?? -1) + 1;
};

const duplicateName = (name: string) => new AppError(409, `A product named ${name} already exists`);

export const createProduct = async (
  data: { name: string; description: string; color: string; talkingPoints: string },
  by: string | null
) => {
  const name = normaliseName(data.name);
  if (await nameTaken(name)) throw duplicateName(name);
  try {
    return await Product.create({ ...data, name, sortOrder: await nextSortOrder(), createdBy: by, updatedBy: by }).save();
  } catch (error) {
    // Two people creating the same name at the same moment: the unique index decides.
    if (isUniqueViolation(error, "UQ_SDR_Products_ActiveName")) throw duplicateName(name);
    throw error;
  }
};

export const updateProduct = async (
  id: string,
  patch: Partial<{ name: string; description: string; color: string; talkingPoints: string }>,
  by: string | null
) => {
  const product = await findActiveProduct(id);
  if (patch.name !== undefined) {
    patch.name = normaliseName(patch.name);
    if (await nameTaken(patch.name, id)) throw duplicateName(patch.name);
  }
  Object.assign(product, patch, { updatedBy: by });
  try {
    return await product.save();
  } catch (error) {
    if (isUniqueViolation(error, "UQ_SDR_Products_ActiveName")) throw duplicateName(product.name);
    throw error;
  }
};

/** Archive = hide from the library and from new demos. Its videos stay and come back on restore. */
export const archiveProduct = async (id: string, by: string | null) => {
  const product = await findActiveProduct(id);
  product.archivedAt = new Date();
  product.updatedBy = by;
  return product.save();
};

export const restoreProduct = async (id: string, by: string | null) => {
  const product = await Product.findOneBy({ id, archivedAt: Not(IsNull()) });
  if (!product) throw new AppError(404, "Archived product not found");
  if (await nameTaken(product.name, id)) {
    throw new AppError(409, `Another active product is already named ${product.name}. Rename it first.`);
  }
  product.archivedAt = null;
  product.sortOrder = await nextSortOrder();
  product.updatedBy = by;
  return product.save();
};

/** Saves a complete new order. The list must contain every active product exactly once. */
export const reorderProducts = async (ids: string[], by: string | null) =>
  AppDataSource.transaction(async (manager) => {
    const active = await manager.find(Product, { where: { archivedAt: IsNull() }, select: { id: true } });
    const activeIds = new Set(active.map((p) => p.id));
    if (ids.length !== activeIds.size || ids.some((id) => !activeIds.has(id))) {
      throw new AppError(422, "ids must list every active product exactly once");
    }
    for (const [index, id] of ids.entries()) {
      await manager.update(Product, { id }, { sortOrder: index, updatedBy: by });
    }
    return manager.find(Product, { where: { archivedAt: IsNull() }, order: { sortOrder: "ASC" } });
  });
