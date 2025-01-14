import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TelegramService {
  constructor(private readonly prisma: PrismaService) {}

  async registerOrUpdateUser(telegramId: string, username: string, userDetails: any) {
    const { firstName, lastName } = userDetails;

    const existingUser = await this.prisma.user.findUnique({
      where: { telegramId },
    });

    if (existingUser) {
      return this.prisma.user.update({
        where: { telegramId },
        data: { username, firstName, lastName },
      });
    } else {
      return this.prisma.user.create({
        data: { telegramId, username, firstName, lastName },
      });
    }
  }

  async addWishlistItem(telegramId: string, itemDetails: any) {
    const existingUser = await this.prisma.user.findUnique({
      where: { telegramId },
    });

    if (!existingUser) {
      throw new Error('User not found');
    }

    return this.prisma.wishlist.create({
      data: {
        ...itemDetails,
        ownerId: existingUser.id,
      },
    });
  }

  async getWishlist(telegramId: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { telegramId },
    });

    if (!existingUser) {
      throw new Error('User not found');
    }
    return this.prisma.wishlist.findMany({
      where: { ownerId: existingUser.id },
    });
  }

  async getWishlistItemDetails(id: number) {
    return this.prisma.wishlist.findUnique({
      where: { id },
    });
  }
  async updateWishlistItem(id: number, updates: { name: string; price: number; url: string }) {
    return this.prisma.wishlist.update({
      where: { id },
      data: updates,
    });
  }
  async getUserByUsername(username: string) {
    const user = await this.prisma.user.findFirst({
      where: { username },
    });
  
    if (!user) {
      throw new Error(`User with username "${username}" does not exist.`);
    }
  
    return user;
  }
  async getWishlistByUserId(userId: number) {
    return this.prisma.wishlist.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        name: true,
        price: true,
        url: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
  
  
  
  
}
