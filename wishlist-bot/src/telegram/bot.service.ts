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
  itemToDelete?: number;
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
    function showMainMenu(ctx: any) {
      ctx.reply(
        'What would you like to do?',
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add Item', 'add')],
            [Markup.button.callback('📜 View My Wishlist', 'view')],
            [Markup.button.callback('🔍 View Others', 'view_others')],
          ]).reply_markup,
        }
      );
    }
    function escapeMarkdownV2(text: string): string {
      return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    }
    function isValidUsername(username: string): boolean {
      const usernameRegex = /^[A-Za-z0-9_]{5,32}$/;
      return usernameRegex.test(username);
    }
    
    
    this.bot.start(async (ctx) => {
      const { id: telegramId, username, first_name: firstName, last_name: lastName } = ctx.from;
    
      await this.telegramService.registerOrUpdateUser(telegramId.toString(), username, {
        firstName,
        lastName,
      });
    
      ctx.reply(
        `Welcome ${firstName || username || 'User'}!`,
      );
    
      showMainMenu(ctx); // Show the main menu

    });
    
    this.bot.action('menu', async (ctx) => {
      showMainMenu(ctx); // Show the main menu

    });
  
    this.bot.action('add', async (ctx) => {
      ctx.session ??= { step: undefined, item: undefined };
      ctx.session.step = 'waiting_for_name';
      ctx.session.item = { name: '', price: 0, url: '' };
      ctx.reply('Please send the name of the item you want to add:');
    });

    this.bot.action('view', async (ctx) => {
      try {
        const telegramId = ctx.from.id.toString();
        const wishes = await this.telegramService.getWishlist(telegramId);
        if (!wishes || wishes.length === 0) {
          ctx.reply(
            `Your wishlist is empty. Use click to button to add items!'`,
            {
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('➕ Add Item', 'add')],
              ]).reply_markup,
            }
          );
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
    this.bot.action('view_others', async (ctx) => {
      ctx.session ??= {}; // Ensure the session exists
      ctx.session.step = 'waiting_for_username'; // Set the session step to track the state
    
      await ctx.answerCbQuery(); // Acknowledge the button click
      ctx.reply('Please enter the username of the person whose wishlist you want to view:');
    });
    

    this.bot.on('text', async (ctx) => {
  // Ensure session is initialized
  ctx.session ??= { step: undefined, item: undefined, editingItem: undefined };

  const { step, item, editingItem } = ctx.session;
  
  
  if (ctx.session?.step === 'waiting_for_username') {
    const username = ctx.message.text.trim();
  
    // Validate the username format
    if (!isValidUsername(username)) {
      ctx.reply(
        'Invalid username format. Accepted characters: A-z (case-insensitive), 0-9, and underscores. Length: 5-32 characters.'
      );
      return;
    }
  
    try {
      const wishlist = await this.telegramService.getWishlistByUsername(username);
  
      if (!wishlist || wishlist.length === 0) {
        ctx.reply(`The user "${username}" does not have any wishlist items.`, {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`📲 Menu`, `menu`)],
          ]).reply_markup,
        });
      } else {
        // Map items to inline keyboard buttons
        const buttons = wishlist.map((item) =>
          Markup.button.callback(item.name, `view_other_${item.id}`)
        );
  
        ctx.reply(`Wishlist for "@${username}":`, {
          reply_markup: Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
        });
        
      }
    } catch (error) {
      console.error('Error fetching wishlist:', error);
      if (error.message.includes('does not exist')) {
        ctx.reply(`The user "${username}" does not exist.`, {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`📲 Menu`, `menu`)],
          ]).reply_markup,
        });
      } else {
        ctx.reply(`Failed to fetch wishlist for user "${username}". Please try again.`, {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`📲 Menu`, `menu`)],
          ]).reply_markup,
        });
      }
    }
  
    // Reset the session step
    ctx.session.step = undefined;
  }
  
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
    ctx.reply(`Item "${item.name}" has been added to your wishlist.`, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`📲 Menu`, `menu`)],
      ]).reply_markup,
    });
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
      await ctx.reply(`Item "${ctx.session.item.name}" has been added to your wishlist.`, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`📲 Menu`, `menu`)],
        ]).reply_markup,
      });
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
            [Markup.button.callback('📝Edit', `edit_${itemId}`)],
           [Markup.button.callback(`❌ Delete`, `delete_${itemId}`)], 
           [Markup.button.callback(`📲 Menu`, `menu`)],
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

    this.bot.action(/^delete_(\d+)$/, async (ctx) => {
      const itemId = parseInt(ctx.match[1], 10);
    
      // Save itemId to session for confirmation
      ctx.session ??= {};
      ctx.session.itemToDelete = itemId;
    
      await ctx.reply('Are you sure you want to delete this item?', {
        reply_markup: Markup.inlineKeyboard([
          Markup.button.callback('Yes', `confirm_delete_${itemId}`),
          Markup.button.callback('No', `cancel_delete`),
        ]).reply_markup,
      });
    });
    // Confirm delete
this.bot.action(/^confirm_delete_(\d+)$/, async (ctx) => {
  const itemId = parseInt(ctx.match[1], 10);

  try {
    await this.telegramService.deleteWishlistItem(itemId);
    await ctx.answerCbQuery('Item deleted successfully');
    ctx.reply('The item has been deleted from your wishlist.');
    showMainMenu(ctx); // Show the main menu

  } catch (error) {
    console.error('Error deleting item:', error);
    ctx.reply('Failed to delete the item. Please try again.');
  }

  // Clear session item
  ctx.session.itemToDelete = undefined;
});

// Cancel delete
this.bot.action('cancel_delete', async (ctx) => {
  await ctx.answerCbQuery('Deletion canceled');
  ctx.reply('Item deletion has been canceled.');
  
  ctx.session.itemToDelete = undefined; // Clear session item
  showMainMenu(ctx); // Show the main menu

});

this.bot.action(/^view_other_(\d+)$/, async (ctx) => {
  const itemId = parseInt(ctx.match[1], 10); // Extract the item ID from the callback data

  try {
    const item = await this.telegramService.getWishlistItemDetails(itemId);

    if (!item) {
      ctx.reply('This item no longer exists.');
      return;
    }

    ctx.reply(
      `*${escapeMarkdownV2(item.name)}*\n` +
        `Price: ${item.price > 0 ? `${item.price} tenge` : 'Not specified'}\n` +
        `URL: ${item.url ? `[Link](${escapeMarkdownV2(item.url)})` : 'Not specified'}`,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
          Markup.button.callback('Reserve', `reserve_${item.id}`),
        ]).reply_markup,
      }
    );
    
  } catch (error) {
    console.error('Error fetching item details:', error);
    ctx.reply('Failed to fetch item details. Please try again.');
  }
});

this.bot.action(/^reserve_(\d+)$/, async (ctx) => {
  const wishId = parseInt(ctx.match[1], 10);
  const userId = ctx.from.id; // Get the Telegram user ID

  try {
    await this.telegramService.reserveTheWish(wishId, String(userId));

    ctx.reply('You have successfully reserved this wishlist item.', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`📲 Menu`, `menu`)],
      ]).reply_markup,
    });

  } catch (error) {
    console.error('Error reserving wishlist item:', error);
    ctx.reply(`Failed to reserve the wishlist item. Reason: ${error.message}`);
  }
});

    
    
    

    // Launch the bot
    this.bot.launch();
    console.log('Bot is running...');
  }
  
  
}
