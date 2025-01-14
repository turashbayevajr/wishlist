import { Controller, Get, Post, Put, Body, Query, Param } from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post('start')
  async handleStart(@Body('telegramId') telegramId: string, @Body('username') username: string, @Body() userDetails: any) {
    return this.telegramService.registerOrUpdateUser(telegramId, username, userDetails);
  }

  @Post('wishlist/add')
  async addItem(@Body('telegramId') telegramId: string, @Body() itemDetails: any) {
    return this.telegramService.addWishlistItem(telegramId, itemDetails);
  }

  @Get('wishlist/view')
  async viewWishlist(@Query('telegramId') telegramId: string) {
    return this.telegramService.getWishlist(telegramId);
  }

  @Get('wishlist/:id')
  async getWishlistItem(@Param('id') id: number) {
    return this.telegramService.getWishlistItemDetails(id);
  }
  @Put('wishlist/edit/:id')
  async editItem(@Param('id') id: number, @Body() updates: any) {
    return this.telegramService.updateWishlistItem(id, updates);
  }
  @Get('/username')
  async getUserByUsername(@Body('username') username: string) {
    return this.telegramService.getUserByUsername(username);
  }
  @Get('/wishlist')
  async getWishlistByUserId(@Body('userId') userId: number) {
    return this.telegramService.getWishlistByUserId(userId);
  }

}
