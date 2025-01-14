import { 
    Controller, 
    Get, Post, Put, Delete, 
    Body, Query, Param, 
    HttpException, HttpStatus } from '@nestjs/common';
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
  @Delete('/wishlist/:id')
  async deleteWishlistItem(@Param('id') id: number) {
  return this.telegramService.deleteWishlistItem(id);
}
@Get('/wishlist/user/:username')
async getWishlistByUsername(@Param('username') username: string) {
  try {
    return await this.telegramService.getWishlistByUsername(username);
  } catch (error) {
    throw new HttpException(error.message, HttpStatus.NOT_FOUND);
  }
}
@Put('/wishlist/:id/reserve')
async reserveWishlistItem(
  @Param('id') id: number,
  @Body('userId') userId: number
): Promise<void> {
  try {
    await this.telegramService.reserveTheWish(id, String(userId));
  } catch (error) {
    throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
  }
}




}
