import { prisma } from '../lib/prisma';

export class ItemService {
  async getItemsByIds(ids: string[]) {
    const existingIds = await prisma.coupon.findMany({
      where: { id: { in: ids } },
    });
    return existingIds;
  }
  async updateMany(ids: string[], data: any) {
    const updatedRecord = await prisma.coupon.updateMany({
      where: { id: { in: ids } },
      data,
    });
    return updatedRecord;
  }
}
