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

    // Register commands
    this.registerStartCommand();
    this.registerAddCommand();
    this.registerViewCommand();
    this.registerEditHandler();
    this.registerMainMenuCommand();


    // Register text handlers for multi-step flows
    this.registerTextHandler();

    // Launch the bot
    this.bot.launch();
    console.log('Bot is running...');
  }
  
  private registerStartCommand() {
    this.bot.start(async (ctx) => {
      const { id: telegramId, username, first_name: firstName, last_name: lastName } = ctx.from;

      // Register or update the user
      await this.telegramService.registerOrUpdateUser(telegramId.toString(), username, {
        firstName,
        lastName,
      });

      ctx.reply(
        `Welcome ${firstName || username || 'User'}! Use /add to add items or /view to see your wishlist.`,
      );
    });
  }

  
  private registerAddCommand() {
    this.bot.command('add', async (ctx) => {
      // Ensure session is initialized
      ctx.session ??= { step: undefined, item: undefined };
  
      // Initialize session state for the `/add` flow
      ctx.session.step = 'waiting_for_name';
      ctx.session.item = { name: '', price: 0, url: '' }; // Provide default values
  
      ctx.reply('Please send the name of the item you want to add:');
    });
  
    // Handle the steps for adding an item
    this.bot.on('text', async (ctx) => {
      if (!ctx.session || !ctx.session.step) return;
  
      switch (ctx.session.step) {
        case 'waiting_for_name':
          ctx.session.item.name = ctx.message.text.trim();
          ctx.session.step = 'waiting_for_price';
  
          ctx.reply('Please send the price of the item or click "Skip".', {
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('Skip', 'skip_price')],
            ]).reply_markup,
          });
          break;
  
        case 'waiting_for_price':
          const price = parseFloat(ctx.message.text.trim());
          if (!isNaN(price)) {
            ctx.session.item.price = price;
            ctx.reply('Price added successfully.');
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
          break;
  
        case 'waiting_for_url':
          ctx.session.item.url = ctx.message.text.trim();
          ctx.reply('Link added successfully.');
  
          // Finalize the item addition
          await this.telegramService.addWishlistItem(ctx.from.id.toString(), ctx.session.item);
          ctx.reply(`Item "${ctx.session.item.name}" has been added to your wishlist.`);
          ctx.session = undefined; // Clear session
          break;
      }
    });
  
    // Handle "Skip" actions
    this.bot.action('skip_price', async (ctx) => {
      await ctx.answerCbQuery(); // Acknowledge callback
    
      // Edit the message to indicate that price was skipped
      await ctx.editMessageText('Price skipped. Please send the link to the item or click "Skip".', {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('Skip', 'skip_link')],
        ]).reply_markup,
      });
    
      ctx.session.step = 'waiting_for_url';
    });
    
    this.bot.action('skip_link', async (ctx) => {
      await ctx.answerCbQuery(); // Acknowledge callback
    
      // Edit the message to indicate that the item was added without a link
      await ctx.editMessageText(`Item "${ctx.session.item.name}" has been added to your wishlist.`);
    
      // Finalize the item addition
      await this.telegramService.addWishlistItem(ctx.from.id.toString(), ctx.session.item);
      ctx.session = undefined; // Clear session
    });
    
  }
  

  private registerViewCommand() {
    // Command to view the wishlist
    this.bot.command('view', async (ctx) => {

      const telegramId = ctx.from.id.toString();
  
      // Fetch the user's wishlist from the service
      const wishes = await this.telegramService.getWishlist(telegramId);
  
      if (wishes.length === 0) {
        // Inform the user if their wishlist is empty
        ctx.reply('Your wishlist is empty.');
      } else {
        // Create inline buttons for each wishlist item
        const buttons = wishes.map((item) =>
          Markup.button.callback(item.name, `view_${item.id}`),
        );
  
        // Display the wishlist with inline buttons
        ctx.reply('Your wishlist:', {
          reply_markup: Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
        });
      }
    });
  
    // Action to handle when a user selects a specific item from their wishlist
    this.bot.action(/^view_(\d+)$/, async (ctx) => {
      const match = ctx.match[1]; // Extract the ID from the callback data
      const itemId = parseInt(match, 10);
  
      // Fetch details of the selected wishlist item
      const itemDetails = await this.telegramService.getWishlistItemDetails(itemId);
  
      if (!itemDetails) {
        // Inform the user if the item no longer exists
        ctx.reply('This wishlist item no longer exists.');
        return;
      }
  
      // Save the selected item in the session for editing
      ctx.session ??= {};
      ctx.session.editingItem = { id: itemId, ...itemDetails };
  
      // Display item details with an Edit button
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
  
    // Action to handle when the user clicks the "Edit" button
    this.bot.action(/^edit_(\d+)$/, async (ctx) => {
      const itemId = parseInt(ctx.match[1], 10);
  
      // Display editing options (Name, Price, URL, Save Changes)
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
  }
  private registerEditHandler() {
    // Handle text inputs for editing
    this.bot.on('text', async (ctx) => {
      // Ensure session is initialized
      ctx.session ??= {};
  
      const { editingField, editingItemId, editingItem } = ctx.session;
  
      if (!editingField || !editingItemId || !editingItem) {
        return; // No active editing session
      }
  
      const value = ctx.message.text;
  
      // Update the session based on the field being edited
      if (editingField === 'name') {
        ctx.session.editingItem.name = value;
        ctx.reply(`Updated name to: ${value}`);
      } else if (editingField === 'price') {
        const parsedValue = parseFloat(value);
        if (isNaN(parsedValue)) {
          ctx.reply('Please enter a valid number for the price.');
          return;
        }
        ctx.session.editingItem.price = parsedValue;
        ctx.reply(`Updated price to: ${parsedValue} tenge`);
      } else if (editingField === 'url') {
        ctx.session.editingItem.url = value;
        ctx.reply(`Updated URL to: ${value}`);
      }
  
      // Clear the editing field but keep the item in the session
      ctx.session.editingField = undefined;
  
      // Offer further editing options or save changes
      ctx.reply(
        'What would you like to do next?',
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('Edit Name', `edit_name_${editingItemId}`)],
            [Markup.button.callback('Edit Price', `edit_price_${editingItemId}`)],
            [Markup.button.callback('Edit URL', `edit_url_${editingItemId}`)],
            [Markup.button.callback('Save Changes', `save_${editingItemId}`)],
          ]).reply_markup,
        },
      );
    });
  
    // Handle "Save Changes" action
    this.bot.action(/^save_(\d+)$/, async (ctx) => {
      const itemId = parseInt(ctx.match[1], 10);
  
      if (!ctx.session.editingItem || ctx.session.editingItemId !== itemId) {
        ctx.reply('Error: No item is being edited.');
        return;
      }
  
      // Save the changes to the database
      const updatedItem = ctx.session.editingItem;
      await this.telegramService.updateWishlistItem(itemId, {
        name: updatedItem.name,
        price: updatedItem.price,
        url: updatedItem.url,
      });
  
      ctx.reply('Your changes have been saved.');
  
      // Clear the session
      ctx.session.editingItem = undefined;
      ctx.session.editingField = undefined;
      ctx.session.editingItemId = undefined;
    });
  
    // Handle editing actions (e.g., Name, Price, URL)
    this.bot.action(/^edit_name_(\d+)$/, async (ctx) => {
      const itemId = parseInt(ctx.match[1], 10);
      ctx.session.editingField = 'name';
      ctx.session.editingItemId = itemId;
  
      ctx.reply('Please enter the new name for the item:');
    });
  
    this.bot.action(/^edit_price_(\d+)$/, async (ctx) => {
      const itemId = parseInt(ctx.match[1], 10);
      ctx.session.editingField = 'price';
      ctx.session.editingItemId = itemId;
  
      ctx.reply('Please enter the new price for the item (in tenge):');
    });
  
    this.bot.action(/^edit_url_(\d+)$/, async (ctx) => {
      const itemId = parseInt(ctx.match[1], 10);
      ctx.session.editingField = 'url';
      ctx.session.editingItemId = itemId;
  
      ctx.reply('Please enter the new URL for the item:');
    });
  }
  private registerMainMenuCommand() {
    this.bot.command('menu', async (ctx) => {
      ctx.reply(
        'Welcome to the Wishlist Bot! What would you like to do?',
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('Add to Wishlist', 'menu_add')],
            [Markup.button.callback('View My Wishlist', 'menu_view')],
            [Markup.button.callback('View Another User’s Wishlist', 'menu_view_username')],
          ]).reply_markup,
        },
      );
    });
  
    // Handle "Add to Wishlist" button
    this.bot.action('menu_add', async (ctx) => {
      ctx.reply('Let’s add an item to your wishlist. Use /add to begin.');
    });
  
    // Handle "View My Wishlist" button
    this.bot.action('menu_view', async (ctx) => {
      const telegramId = ctx.from.id.toString();
  
      const wishes = await this.telegramService.getWishlist(telegramId);
  
      if (wishes.length === 0) {
        ctx.reply('Your wishlist is empty. Use /add to start adding items!');
      } else {
        const buttons = wishes.map((item) =>
          Markup.button.callback(item.name, `view_${item.id}`),
        );
  
        ctx.reply('Your wishlist:', {
          reply_markup: Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
        });
      }
    });
  
    // Handle "View Another User’s Wishlist" button
    this.bot.action('menu_view_username', async (ctx) => {
      ctx.session ??= {};
      ctx.session.step = 'waiting_for_username';
  
      ctx.reply('Please enter the username of the user whose wishlist you want to view:');
    });
  }
  

  private registerTextHandler() {
    this.bot.on('text', async (ctx) => {
      // Ensure the session is initialized
      ctx.session ??= { step: undefined, item: undefined };
  
      const { step, item } = ctx.session;
      if (step === 'waiting_for_username') {
        const username = ctx.message.text.trim();
  
        // Fetch the user by username
        const user = await this.telegramService.getUserByUsername(username);
  
        if (!user) {
          ctx.reply(`No user found with the username "${username}". Please try again.`);
          return;
        }
  
        // Fetch the user's wishlist
        const wishes = await this.telegramService.getWishlistByUserId(user.id);
  
        if (wishes.length === 0) {
          ctx.reply(`${username}'s wishlist is empty.`);
        } else {
          const buttons = wishes.map((item) =>
            Markup.button.callback(`Order "${item.name}"`, `order_${item.id}`),
          );
  
          ctx.reply(`${username}'s wishlist:`, {
            reply_markup: Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
          });
        }
  
        // Clear the session step
        ctx.session.step = undefined;
      }
      if (step === 'waiting_for_name') {
        // Save the name and move to the next step
        item.name = ctx.message.text;
        ctx.session.step = 'waiting_for_price';
  
        ctx.reply(
          'What is the price of the item?',
          Markup.inlineKeyboard([Markup.button.callback('Skip', 'skip_price')]),
        );
      } else if (step === 'waiting_for_price') {
        const input = ctx.message.text.toLowerCase();
        if (input === 'skip') {
          item.price = 0; // Default price
        } else {
          const price = parseFloat(input);
          if (isNaN(price)) {
            ctx.reply('Please enter a valid number for the price or press "Skip".');
            return;
          }
          item.price = price;
        }
  
        ctx.session.step = 'waiting_for_url';
        ctx.reply(
          'What is the URL of the item?',
          Markup.inlineKeyboard([Markup.button.callback('Skip', 'skip_url')]),
        );
      } else if (step === 'waiting_for_url') {
        const input = ctx.message.text.toLowerCase();
        item.url = input === 'skip' ? '' : ctx.message.text; // Save the URL or leave blank
  
        // Add the item to the wishlist
        await this.telegramService.addWishlistItem(ctx.from.id.toString(), {
          name: item.name,
          price: item.price,
          url: item.url,
        });
  
        ctx.reply(`Added "${item.name}" to your wishlist.`);
        ctx.session.step = undefined; // Clear session state
        ctx.session.item = undefined; // Clear session item
      }
    });
  
    // Handle "Skip" button actions
    this.bot.action('skip_price', async (ctx) => {
      ctx.session.item.price = 0; // Set default price
      ctx.session.step = 'waiting_for_url';
  
      await ctx.editMessageText(
        'What is the URL of the item?',
        Markup.inlineKeyboard([Markup.button.callback('Skip', 'skip_url')]),
      );
    });
  
    this.bot.action('skip_url', async (ctx) => {
      ctx.session.item.url = ''; // Set default URL
  
      // Add the item to the wishlist
      await this.telegramService.addWishlistItem(ctx.from.id.toString(), {
        name: ctx.session.item.name,
        price: ctx.session.item.price,
        url: ctx.session.item.url,
      });
  
      await ctx.editMessageText(`Added "${ctx.session.item.name}" to your wishlist.`);
      ctx.session.step = undefined; // Clear session state
      ctx.session.item = undefined; // Clear session item
    });
  }
  
}
