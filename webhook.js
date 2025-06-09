
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { InteractionType, Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');
const bodyParser = require('body-parser');
const fs = require('fs');

app.use(bodyParser.raw({ type: 'application/json' }));

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const PORT = process.env.PORT || 3000;

app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed.`, err.message);
    return res.sendStatus(400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;
    const discordId = metadata.discord_id;
    const product = metadata.product;
    const duration = metadata.duration;

    const config = JSON.parse(fs.readFileSync('config.json'));
    const keys = JSON.parse(fs.readFileSync('keys.json'));

    const keyList = keys[product][duration];
    const key = keyList.shift();

    fs.writeFileSync('keys.json', JSON.stringify(keys, null, 2));

    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] });
    client.once('ready', async () => {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const member = await guild.members.fetch(discordId);
      const category = process.env.TICKET_CATEGORY_ID;
      const channel = await guild.channels.create({
        name: `ticket-${member.user.username}`,
        type: ChannelType.GuildText,
        parent: category,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: member.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
          },
          {
            id: process.env.STAFF_ROLE_ID,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
          }
        ]
      });

      await channel.send({
        content: `<@${member.id}>`,
        embeds: [{
          title: "✅ Thank you for your purchase!",
          description: `🎁 **Product**: ${config.products[product].name} (${duration})\n🔑 **Your Key**: \`${key}\`\n\nPlease press the button below once you've copied your key.`,
          color: 0x00ff00
        }],
        components: [{
          type: 1,
          components: [{
            type: 2,
            style: 3,
            label: "✅ I Got My Key",
            custom_id: "close_ticket"
          }]
        }]
      });

      const logChannel = await guild.channels.fetch(process.env.LOG_CHANNEL_ID);
      await logChannel.send(`🧾 **New Purchase**\n👤 <@${member.id}> (${member.id})\n📦 Product: ${config.products[product].name}\n⏳ Duration: ${duration}\n🔑 Key: \`${key}\``);

      client.destroy();
    });

    client.login(process.env.DISCORD_TOKEN);
  }

  res.send();
});

app.listen(PORT, () => console.log(`Webhook listening on port ${PORT}`));
