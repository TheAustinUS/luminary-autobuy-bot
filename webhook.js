require('dotenv').config();
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.login(process.env.DISCORD_TOKEN);

app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.log('Webhook signature error:', err.message);
    return res.sendStatus(400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;
    const userId = metadata.discord_id;
    const productId = metadata.product;
    const duration = metadata.duration;

    const keys = JSON.parse(fs.readFileSync('./keys.json', 'utf-8'));
    const products = JSON.parse(fs.readFileSync('./products.json', 'utf-8'));
    const keyList = keys[productId]?.[duration] || [];

    if (!keyList.length) return res.sendStatus(200);

    const key = keyList.shift();
    fs.writeFileSync('./keys.json', JSON.stringify(keys, null, 2));

    client.guilds.fetch(process.env.GUILD_ID).then(async guild => {
      const member = await guild.members.fetch(userId);
      const ticketChannel = guild.channels.cache.find(c => c.name.includes(member.user.username) && c.isTextBased());
      if (!ticketChannel) return;

      await ticketChannel.send(\`✅ **Payment confirmed!**\n🎁 Product: \${products[productId].name} (\${duration})\n🔑 Key: \`\`\`\${key}\`\`\`\`);

      await ticketChannel.send({
        components: [{
          type: 1,
          components: [{
            type: 2,
            label: '✅ I Copied My Key',
            style: 3,
            custom_id: 'close_ticket'
          }]
        }]
      });

      const logChannel = await guild.channels.fetch(process.env.LOG_CHANNEL_ID);
      logChannel.send(\`🧾 **Product**: \${products[productId].name}\n👤 <@${userId}>\n🔑 Key: \${key}\`);
    });
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => console.log('✅ Stripe webhook listening'));
