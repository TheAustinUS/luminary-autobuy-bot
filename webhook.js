require('dotenv').config();
const fs = require('fs');
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder
} = require('discord.js');

const app = express();
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.login(process.env.DISCORD_TOKEN);

client.once('ready', () => {
  console.log(`✅ Webhook bot ready as ${client.user.tag}`);
});

app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.log('❌ Webhook error:', err.message);
    return res.sendStatus(400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { discord_id, product, duration } = session.metadata;

    const keys = JSON.parse(fs.readFileSync('./keys.json', 'utf-8'));
    const products = JSON.parse(fs.readFileSync('./products.json', 'utf-8'));
    const productKeys = keys[product]?.[duration];

    if (!productKeys || !productKeys.length) {
      console.warn(`⚠️ No keys left for ${product} - ${duration}`);
      return res.sendStatus(200);
    }

    const key = productKeys.shift();
    fs.writeFileSync('./keys.json', JSON.stringify(keys, null, 2));

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discord_id);
    const allChannels = await guild.channels.fetch();

    const ticketChannel = [...allChannels.values()].find(
      c => c.type === ChannelType.GuildText && c.name.includes(member.user.username)
    );

    if (!ticketChannel) {
      console.warn(`⚠️ Ticket not found for ${member.user.username}`);
      return res.sendStatus(200);
    }

    const embed = {
      title: '✅ Payment Confirmed',
      description: `🎁 **Product**: ${products[product].name} (${duration})\n🔑 **Key:**\n\`\`\`${key}\`\`\``,
      color: 0x00cc66
    };

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('✅ I Copied My Key')
        .setStyle(ButtonStyle.Success)
    );

    await ticketChannel.send({ embeds: [embed], components: [confirmRow] });

    const logChannel = await guild.channels.fetch(process.env.LOG_CHANNEL_ID);
    await logChannel.send(`🧾 **Product**: ${products[product].name}\n👤 <@${discord_id}> (${discord_id})\n🔑 Key: \`${key}\``);
  }

  res.sendStatus(200);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    await interaction.reply('👋 Thanks! This ticket will close automatically in 2 minutes.');

    setTimeout(async () => {
      try {
        await interaction.channel.delete('Customer confirmed key received.');
      } catch (err) {
        console.error('❌ Error closing ticket:', err);
      }
    }, 120000);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('🌐 Webhook server running');
});
