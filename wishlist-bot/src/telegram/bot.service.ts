import { Injectable } from '@nestjs/common';
import { Telegraf, Context, session, Markup } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';

interface BotSession {
  step?: 'waiting_for_name' | 'waiting_for_price' | 'waiting_for_url' | 'waiting_for_username';
  item?: {
    name: string;
    price: number;
    url: string;
  };
  editingItem?: {
    id: number;
    name: string;
    price: number;
    url: string;
  };
  editingField?: 'name' | 'price' | 'url';
  editingItemId?: number;
}

type BotContext = Context & { session: BotSession };

@Injectable()
export class BotService {
  private bot: Telegraf<BotContext>;

  constructor(
    private readonly configService: ConfigService,
    private readonly telegramService: TelegramService,
    
  ) {
    // Initialize bot
    
    this.bot = new Telegraf<BotContext>(this.configService.get<string>('BOT_TOKEN'));

    // Apply session middleware
    this.bot.use(session({ defaultSession: () => ({}) }));

    // Register commands and actions
    
    this.bot.start(async (ctx) => {
      const { id: telegramId, username, first_name: firstName, last_name: lastName } = ctx.from;
      await this.telegramService.registerOrUpdateUser(telegramId.toString(), username, {
        firstName,
        lastName,
      });
      ctx.reply(
        `Welcome ${firstName || username || 'User'}! Use /add to add items or /view to see your wishlist.`,
      );
    });

    this.bot.command('add', async (ctx) => {
      ctx.session ??= { step: undefined, item: undefined };
      ctx.session.step = 'waiting_for_name';
      ctx.session.item = { name: '', price: 0, url: '' };
      ctx.reply('Please send the name of the item you want to add:');
    });

    this.bot.command('view', async (ctx) => {
      try {
        const telegramId = ctx.from.id.toString();
        const wishes = await this.telegramService.getWishlist(telegramId);
        if (!wishes || wishes.length === 0) {
          ctx.reply('Your wishlist is empty. Use /add to add items!');
        } else {
          const buttons = wishes.map((item) =>
            Markup.button.callback(item.name, `view_${item.id}`),
          );
          ctx.reply('Your wishlist:', {
            reply_markup: Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
          });
        }
      } catch (error) {
        console.error('Error in /view command:', error);
        ctx.reply('An error occurred while fetching your wishlist. Please try again.');
      }
    });

    this.bot.on('text', async (ctx) => {
  // Ensure session is initialized
  ctx.session ??= { step: undefined, item: undefined, editingItem: undefined };

  const { step, item, editingItem } = ctx.session;

  // Add item flow
  if (step === 'waiting_for_name') {
    item.name = ctx.message.text.trim();
    ctx.session.step = 'waiting_for_price';
    ctx.reply('Please send the price of the item or click "Skip".', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Skip', 'skip_price')],
      ]).reply_markup,
    });
  } else if (step === 'waiting_for_price') {
    const price = parseFloat(ctx.message.text.trim());
    if (!isNaN(price)) {
      item.price = price;
    } else {
      ctx.reply('Invalid price. Please enter a number or click "Skip".');
      return;
    }
    ctx.session.step = 'waiting_for_url';
    ctx.reply('Please send the link to the item or click "Skip".', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Skip', 'skip_link')],
      ]).reply_markup,
    });
  } else if (step === 'waiting_for_url') {
    item.url = ctx.message.text.trim();
    await this.telegramService.addWishlistItem(ctx.from.id.toString(), item);
    ctx.reply(`Item "${item.name}" has been added to your wishlist.`);
    ctx.session = undefined;
  }

  // Editing item flow
  else if (editingItem) {
    const { editingField } = ctx.session;

    if (!editingField) {
      ctx.reply('Error: No field selected for editing. Please use the available options.');
      return;
    }

    // Update the specific field
    if (editingField === 'name') {
      editingItem.name = ctx.message.text.trim();
      ctx.reply(`Updated name to: ${editingItem.name}`);
    } else if (editingField === 'price') {
      const price = parseFloat(ctx.message.text.trim());
      if (isNaN(price)) {
        ctx.reply('Invalid price. Please enter a valid number.');
        return;
      }
      editingItem.price = price;
      ctx.reply(`Updated price to: ${editingItem.price} tenge`);
    } else if (editingField === 'url') {
      editingItem.url = ctx.message.text.trim();
      ctx.reply(`Updated URL to: ${editingItem.url}`);
    }

    // Save updated item back to session
    ctx.session.editingItem = editingItem;

    // Reset the editing field for the next action
    ctx.session.editingField = undefined;

    // Provide options for the next step
    ctx.reply('What would you like to save changes?', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Save Changes', `save_${editingItem.id}`)],
      ]).reply_markup,
    });
  }
});

    

    this.bot.action('skip_price', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.editMessageText('Price skipped. Please send the link to the item or click "Skip".', {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('Skip', 'skip_link')],
        ]).reply_markup,
      });
      ctx.session.step = 'waiting_for_url';
    });

    this.bot.action('skip_link', async (ctx) => {
      await ctx.answerCbQuery();
      await this.telegramService.addWishlistItem(ctx.from.id.toString(), ctx.session.item);
      await ctx.editMessageText(`Item "${ctx.session.item.name}" has been added to your wishlist.`);
      ctx.session = undefined;
    });

    
    this.bot.action(/^view_(\d+)$/, async (ctx) => {
      const itemId = parseInt(ctx.match[1], 10);
      const itemDetails = await this.telegramService.getWishlistItemDetails(itemId);
      if (!itemDetails) {
        ctx.reply('This wishlist item no longer exists.');
        return;
      }
      ctx.session ??= {};
      ctx.session.editingItem = { id: itemId, ...itemDetails };
      ctx.reply(
        `Wishlist Item Details:\n\n` +
          `*Name:* ${itemDetails.name}\n` +
          `*Price:* ${itemDetails.price > 0 ? `${itemDetails.price} tenge` : 'Not specified'}\n` +
          `*URL:* ${itemDetails.url ? `[Link](${itemDetails.url})` : 'Not specified'}`,
        {
          parse_mode: 'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([
            Markup.button.callback('Edit', `edit_${itemId}`),
          ]).reply_markup,
        },
      );
    });

    this.bot.action(/^edit_(\d+)$/, async (ctx) => {
      const itemId = parseInt(ctx.match[1], 10);
      ctx.reply(
        'What would you like to edit?',
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('Name', `edit_name_${itemId}`)],
            [Markup.button.callback('Price', `edit_price_${itemId}`)],
            [Markup.button.callback('URL', `edit_url_${itemId}`)],
            [Markup.button.callback('Save Changes', `save_${itemId}`)],
          ]).reply_markup,
        },
      );
    });

    this.bot.action(/^edit_(name|price|url)_(\d+)$/, async (ctx) => {
      const field = ctx.match[1] as 'name' | 'price' | 'url';
      const itemId = parseInt(ctx.match[2], 10);
    
      ctx.session.editingField = field;
      ctx.session.editingItemId = itemId;
    
      // Fetch the item details to be edited from the session or the database
      const itemDetails = await this.telegramService.getWishlistItemDetails(itemId);
      ctx.session.editingItem = itemDetails;
    
      const prompts: Record<'name' | 'price' | 'url', string> = {
        name: 'Please enter the new name for the item:',
        price: 'Please enter the new price for the item (in tenge):',
        url: 'Please enter the new URL for the item:',
      };
    
      // Send the prompt to edit the chosen field
      ctx.reply(prompts[field]);
    });
  
    this.bot.action(/^save_(\d+)$/, async (ctx) => {
      const itemId = parseInt(ctx.match[1], 10);
    
      if (!ctx.session.editingItem || ctx.session.editingItemId !== itemId) {
        ctx.reply('Error: No item is being edited.');
        return;
      }
    
      const updatedItem = ctx.session.editingItem;
    
      try {
        await this.telegramService.updateWishlistItem(itemId, updatedItem);
        ctx.reply(`Your changes for item "${updatedItem.name}" have been saved.`, {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('View wish', `view_${itemId}`)],
          ]).reply_markup,
        });
        ctx.session = undefined; // Clear session after saving
      } catch (error) {
        console.error('Error saving item:', error);
        ctx.reply('Failed to save changes. Please try again.');
      }
    });
    
    

    // Launch the bot
    this.bot.launch();
    console.log('Bot is running...');
  }
  
  
}
