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
  async deleteWishlistItem(itemId: number) {
    const existingItem = await this.prisma.wishlist.findUnique({
      where: { id: itemId },
    });
  
    if (!existingItem) {
      throw new Error('Item not found');
    }
  
    return this.prisma.wishlist.delete({
      where: { id: itemId },
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
  async getWishlistByUsername(username: string) {
    // Find user by username
    const user = await this.getUserByUsername(username);
  
    // Fetch and return their wishlist
    return this.getWishlistByUserId(user.id);
  }
  async reserveTheWish(wishId: number, userId: string): Promise<void> {
    // Check if the wish exists
    const wish = await this.prisma.wishlist.findUnique({
      where: { id: wishId },
    });
  
    if (!wish) {
      throw new Error(`Wishlist item with ID ${wishId} does not exist.`);
    }
  
    // Update the orderedUserId
    await this.prisma.wishlist.update({
      where: { id: wishId },
      data: {
        orderedUserId: userId,
      },
    });
  }
  
  
  
  
}
