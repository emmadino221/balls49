import os
import telebot
from telebot import types

# ================== CONFIG ==================
TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
if not TOKEN:
    raise RuntimeError('Set TELEGRAM_BOT_TOKEN in the environment before starting the Python bot.')
bot = telebot.TeleBot(TOKEN)

user_data = {}

ODDS_OPTIONS = {
    "2.00": 2.00,
    "1.50": 1.50,
    "1.65": 1.65,
    "3.80": 3.80, # Total Color Base Odds
    "7.80": 7.80,
    "1.10": 1.10
}

# ── High/Low Calculation (2x Multiplier) ──
def calculate_high_low_steps(initial_stake: float, max_steps: int):
    total_lost = 0.0
    bets = []
    profits = []
    current_bet = initial_stake

    for step in range(1, max_steps + 1):
        bet = round(current_bet, 2)
        bets.append(bet)

        # Profit calculation (Odds 2.0)
        win_amount = round(bet * 2.0, 2)
        total_risked_so_far = total_lost + bet
        net_profit = round(win_amount - total_risked_so_far, 2)
        profits.append(net_profit)

        total_lost += bet
        current_bet = bet * 2.0  # Strict 2x multiplier

    return bets, profits, round(total_lost, 2)

# ── High/Low Calculation (1.40x Multiplier) ──
def calculate_high_low_140_steps(initial_stake: float, max_steps: int):
    total_lost = 0.0
    bets = []
    profits = []
    current_bet = initial_stake

    for step in range(1, max_steps + 1):
        bet = round(current_bet, 2)
        bets.append(bet)

        # Profit calculation (Odds 2.0)
        win_amount = round(bet * 2.0, 2)
        total_risked_so_far = total_lost + bet
        net_profit = round(win_amount - total_risked_so_far, 2)
        profits.append(net_profit)

        total_lost += bet
        current_bet = bet * 1.40  # Strict 1.40x multiplier

    return bets, profits, round(total_lost, 2)

# ── Rainbow Calculation (1.50 Odds) ──
def calculate_rainbow_steps(initial_stake: float, max_steps: int):
    odds = 1.50
    target_profit = initial_stake * (odds - 1)
    total_lost = 0.0
    bets = []
    profits = []

    for step in range(1, max_steps + 1):
        if step == 1:
            bet = round(initial_stake, 2)
        else:
            bet = round((total_lost + target_profit) / (odds - 1), 2)
        
        bets.append(bet)
        total_lost += bet
        profits.append(round(target_profit, 2))

    return bets, profits, round(total_lost, 2)

# ── BetZero Calculation (1.65 Odds) ──
def calculate_betzero_steps(initial_stake: float, max_steps: int):
    odds = 1.65
    target_profit = initial_stake * (odds - 1)
    total_lost = 0.0
    bets = []
    profits = []

    for step in range(1, max_steps + 1):
        if step == 1:
            bet = round(initial_stake, 2)
        else:
            bet = round((total_lost + target_profit) / (odds - 1), 2)
        
        bets.append(bet)
        total_lost += bet
        profits.append(round(target_profit, 2))

    return bets, profits, round(total_lost, 2)

# ── Total Color Break-Even Calculation (3-Way Split, 0.8 Margin Factor) ──
def calculate_total_color_steps(initial_stake: float, max_steps: int):
    total_lost = 0.0
    bets = []
    profits = []
    current_stake = initial_stake

    for step in range(1, max_steps + 1):
        if step == 1:
            current_stake = initial_stake
        else:
            # Dynamic formula: Required Stake = Total Cumulative Loss / 0.8
            current_stake = total_lost / 0.8
        
        bet = round(current_stake, 2)
        bets.append(bet)
        
        # 3 tickets purchased per draw
        draw_cost = bet * 3
        total_lost += draw_cost
        
        # Break-even target output (Net profit is 0 or close to break-even boundary)
        if step == 1:
            net_profit = round((bet * 3.8) - draw_cost, 2) # Base profit on step 1 (+0.8 unit margin)
        else:
            net_profit = 0.00 # Pure break-even recovery on steps 2+
            
        profits.append(net_profit)

    return bets, profits, round(total_lost, 2)

# ── Total Color 2-Way Profit Calculation (2-Way Split, 1.8 Margin Factor) ──
def calculate_total_color_2way_steps(initial_stake: float, max_steps: int):
    total_lost = 0.0
    bets = []
    profits = []
    current_stake = initial_stake

    for step in range(1, max_steps + 1):
        if step == 1:
            current_stake = initial_stake
            net_profit = round((current_stake * 3.8) - (current_stake * 2), 2)
        else:
            # Dynamic formula: Required Stake = (Total Cumulative Loss + Base Target Profit) / 1.8
            current_stake = (total_lost + initial_stake) / 1.8
            net_profit = round(initial_stake, 2) # Maintains steady target profit per step
        
        bet = round(current_stake, 2)
        bets.append(bet)
        
        # 2 tickets purchased per draw
        draw_cost = bet * 2
        total_lost += draw_cost
            
        profits.append(net_profit)

    return bets, profits, round(total_lost, 2)

# ── Standard Custom Martingale ──
def calculate_martingale_steps(initial_stake: float, odds: float, max_steps: int):
    target_profit = initial_stake * (odds - 1)
    total_lost = 0.0
    bets = []
    profits = []
    for step in range(1, max_steps + 1):
        if step == 1:
            bet = round(initial_stake, 2)
        else:
            bet = round((total_lost + target_profit) / (odds - 1), 2)
        total_lost += bet
        bets.append(bet)
        profits.append(round(target_profit, 2))          
    return bets, profits, round(total_lost, 2)

# ===================== COMMANDS =====================
@bot.message_handler(commands=['start'])
def start(message):
    bot.reply_to(message,
        "🎰 <b>Unified Strategy Bot (₦)</b>\n\n"
        "Type <b>/plan</b> → now shows profit after every step!",
        parse_mode='HTML')

@bot.message_handler(commands=['plan'])
def start_plan(message):
    user_id = message.chat.id
    user_data[user_id] = {'state': 'strategy'}

    markup = types.InlineKeyboardMarkup(row_width=1)
    markup.add(types.InlineKeyboardButton("🔵 BetZero (1.65 Odds)", callback_data="strat_betzero"))
    markup.add(types.InlineKeyboardButton("🌈 Rainbow (1.50 Odds)", callback_data="strat_rainbow"))
    markup.add(types.InlineKeyboardButton("📊 High/Low (2x Multiplier)", callback_data="strat_hilo"))
    markup.add(types.InlineKeyboardButton("📈 High/Low (1.40x Multiplier)", callback_data="strat_hilo_140"))
    markup.add(types.InlineKeyboardButton("🎨 Total Color (Break-Even 3W)", callback_data="strat_total_color"))
    markup.add(types.InlineKeyboardButton("🎭 Total Color (Profit 2W)", callback_data="strat_total_color_2way"))
    markup.add(types.InlineKeyboardButton("⚙️ Custom Martingale", callback_data="strat_martingale"))

    bot.reply_to(message, "🎯 Choose game strategy:", parse_mode='HTML', reply_markup=markup)

# ===================== CALLBACKS =====================
@bot.callback_query_handler(func=lambda call: True)
def handle_callback(call):
    user_id = call.message.chat.id
    if user_id not in user_data:
        return

    if call.data.startswith("strat_"):
        if call.data == "strat_martingale":
            strategy = "martingale"
            name = "Custom Martingale"
        elif call.data == "strat_hilo":
            strategy = "hilo"
            name = "High/Low (2x Multiplier)"
        elif call.data == "strat_hilo_140":
            strategy = "hilo_140"
            name = "High/Low (1.40x Multiplier)"
        elif call.data == "strat_rainbow":
            strategy = "rainbow"
            name = "Rainbow (1.50 Odds)"
        elif call.data == "strat_betzero":
            strategy = "betzero"
            name = "BetZero (1.65 Odds)"
        elif call.data == "strat_total_color":
            strategy = "total_color"
            name = "Total Color Break-Even (3W)"
        elif call.data == "strat_total_color_2way":
            strategy = "total_color_2way"
            name = "Total Color Profit (2W)"

        user_data[user_id] = {'state': 'odd', 'strategy': strategy, 'name': name}

        # Dedicated strategies bypass the odds selection menu
        dedicated_strats = ["total_color", "total_color_2way", "hilo", "hilo_140", "rainbow", "betzero"]
        if strategy in dedicated_strats:
            odds_map = {
                "total_color": 3.8,
                "total_color_2way": 3.8,
                "hilo": 2.0,
                "hilo_140": 2.0,
                "rainbow": 1.5,
                "betzero": 1.65
            }
            user_data[user_id]['odds'] = odds_map[strategy]
            user_data[user_id]['state'] = 'stake'
            bot.edit_message_text(f"✅ <b>{name}</b> selected\n\nEnter initial base stake (₦):",
                                  call.message.chat.id, call.message.message_id, parse_mode='HTML')
            return

        markup = types.InlineKeyboardMarkup(row_width=2)
        for label, value in ODDS_OPTIONS.items():
            markup.add(types.InlineKeyboardButton(label, callback_data=f"odd_{value}"))
        markup.add(types.InlineKeyboardButton("🔢 Custom Odd", callback_data="odd_custom"))

        bot.edit_message_text(f"✅ {name} selected\n\nChoose odds to calculate:",
                              call.message.chat.id, call.message.message_id, parse_mode='HTML', reply_markup=markup)

    elif call.data.startswith("odd_"):
        if call.data == "odd_custom":
            bot.edit_message_text("Enter custom odd (e.g. 1.85):", call.message.chat.id, call.message.message_id)
            user_data[user_id]['state'] = 'custom_odd'
        else:
            odds = float(call.data.split("_")[1])
            user_data[user_id]['odds'] = odds
            user_data[user_id]['state'] = 'stake'
            bot.edit_message_text(f"✅ Odd: <b>{odds}</b>\n\nEnter initial base stake (₦):",
                                  call.message.chat.id, call.message.message_id, parse_mode='HTML')

# ===================== MESSAGE HANDLER =====================
@bot.message_handler(func=lambda m: True)
def handle_all(message):
    user_id = message.chat.id
    if user_id not in user_data:
        return
    state = user_data[user_id].get('state')

    try:
        if state == 'custom_odd':
            odds = float(message.text)
            if odds <= 1:
                bot.reply_to(message, "❌ Odd must be > 1")
                return
            user_data[user_id]['odds'] = odds
            user_data[user_id]['state'] = 'stake'
            bot.reply_to(message, f"✅ Custom odd: <b>{odds}</b>\n\nEnter initial base stake (₦):", parse_mode='HTML')
            return

        if state == 'stake':
            stake = float(message.text)
            user_data[user_id]['stake'] = stake
            user_data[user_id]['state'] = 'steps'
            bot.reply_to(message, f"✅ Base Stake: ₦{stake:,.2f}\n\nHow many Martingale steps? (e.g. 8)")
            return

        if state == 'steps':
            steps = int(message.text)
            if not 1 <= steps <= 30:
                bot.reply_to(message, "Enter a valid step limit between 1–30")
                return
            user_data[user_id]['steps'] = steps
            user_data[user_id]['state'] = 'capital'
            bot.reply_to(message, "✅ Steps set\n\nEnter total available capital (₦):")
            return

        if state == 'capital':
            capital = float(message.text)
            data = user_data[user_id]
            strategy = data['strategy']
            name = data['name']
            stake = data['stake']
            odds = data.get('odds', 2.0)
            max_steps = data['steps']

            # Route to the correct calculation engine
            if strategy == "martingale":
                bets, profits, total = calculate_martingale_steps(stake, odds, max_steps)
            elif strategy == "hilo":
                bets, profits, total = calculate_high_low_steps(stake, max_steps)
            elif strategy == "hilo_140":
                bets, profits, total = calculate_high_low_140_steps(stake, max_steps)
            elif strategy == "rainbow":
                bets, profits, total = calculate_rainbow_steps(stake, max_steps)
            elif strategy == "betzero":
                bets, profits, total = calculate_betzero_steps(stake, max_steps)
            elif strategy == "total_color":
                bets, profits, total = calculate_total_color_steps(stake, max_steps)
            elif strategy == "total_color_2way":
                bets, profits, total = calculate_total_color_2way_steps(stake, max_steps)

            # Build output
            text = f"📊 <b>{name} Sequence</b>\n\n"
            text += f"Target Odds: <b>{odds}</b> | Base Unit: <b>₦{stake:,.2f}</b> | Steps: <b>{max_steps}</b>\n\n"

            for i, (bet, profit) in enumerate(zip(bets, profits), 1):
                profit_str = f"+₦{profit:,.2f}" if profit >= 0 else f"-₦{abs(profit):,.2f}"
                text += f"{i} → ₦{bet:,.2f}   ({profit_str})\n"

            text += f"\nTotal risked across sequence: <b>₦{total:,.2f}</b>"

            if total > capital * 0.8:
                text += "\n\n🚨 Warning: Total Risk exceeds 80% of your declared capital!"

            bot.reply_to(message, text, parse_mode='HTML')
            del user_data[user_id]

    except ValueError:
        bot.reply_to(message, "❌ Please send a valid number.")

print("🚀 Unified Sequence Calculator Bot is running...")
bot.infinity_polling()