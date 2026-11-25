// Same shape as be-admin-portal's paginate().
export const paginate = (page: number, take: number, totalCount = 0) => {
  const totalPages = Math.ceil(totalCount / take);
  return {
    totalCount,
    page,
    take,
    skip: (page - 1) * take,
    previous: page > 1 ? page - 1 : null,
    next: page < totalPages ? page + 1 : null,
    lastPage: totalPages
  };
};
