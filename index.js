require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');

const app = express();
app.use(express.json());

const pendingCodes = new Map();
const sessionStatus = new Map(); // robloxUserId -> boolean (true ha EBBEN a körben összekötötték)
const LOG_CHANNEL_ID = "1558482103622967476";

app.post('/api/generate-code', (req, res) => {
    if (req.headers['x-api-key'] !== process.env.ROBLOX_SECRET_KEY) return res.status(401).send();
    const { robloxUserId, robloxUsername } = req.body;
    const rId = String(robloxUserId);

    // MINDEN BELÉPÉSNÉL TÖRLÜNK MINDEN ELŐZMÉNYT
    sessionStatus.set(rId, false); 
    for (const [c, data] of pendingCodes.entries()) {
        if (data.robloxUserId === rId) pendingCodes.delete(c);
    }

    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    pendingCodes.set(code, { robloxUserId: rId, robloxUsername, createdAt: Date.now() });
    
    console.log(`[ÚJ KÓD] ${robloxUsername} (${rId}) -> ${code}`);
	res.json({ code, expiresIn: 300 });
});

app.get('/api/check-link/:robloxUserId', (req, res) => {
    const rId = String(req.params.robloxUserId);
    res.json({ linked: sessionStatus.get(rId) || false });
});

app.listen(process.env.PORT || 3000);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId === 'link_button') {
        const modal = new ModalBuilder().setCustomId('link_modal').setTitle('Fiók összekötés');
        const input = new TextInputBuilder().setCustomId('link_code').setLabel('Kód').setStyle(TextInputStyle.Short).setMinLength(6).setMaxLength(6).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'link_modal') {
        const enteredCode = interaction.fields.getTextInputValue('link_code').trim().toUpperCase();
        const data = pendingCodes.get(enteredCode);

        if (!data) return interaction.reply({ content: 'Hiba: Érvénytelen kód!', ephemeral: true });

        // EBBEN A PILLANATBAN JELEZZÜK A SIKERT A ROBLOXNAK
        sessionStatus.set(data.robloxUserId, true);
        pendingCodes.delete(enteredCode);

        await interaction.reply({ content: 'Sikeresen összekötötted a Roblox fiókodat!', ephemeral: true });

        try {
            const channel = await client.channels.fetch(LOG_CHANNEL_ID);
            if (channel) {
                const log = new EmbedBuilder()
                    .setTitle('Fiók összekapcsolás')
                    .addFields(
                        { name: 'Roblox név', value: `${data.robloxUsername}`, inline: true },
                        { name: 'Roblox ID', value: `${data.robloxUserId}`, inline: true },
                        { name: 'Discord', value: `${interaction.user.tag}` }
                    )
                    .setColor(0x000000);
                await channel.send({ embeds: [log] });
            }
        } catch (e) {}
    }
});

client.on('messageCreate', async (m) => {
    if (m.content === '!panel' && !m.author.bot) {
        const embed = new EmbedBuilder().setTitle('Fiók összekötés').setDescription("A Roblox-fiókok összekötésének célja a biztonság növelése.").setColor(0x000000);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('link_button').setLabel('Összekötés').setStyle(ButtonStyle.Secondary));
        await m.channel.send({ embeds: [embed], components: [row] });
    }
});
client.login(process.env.DISCORD_BOT_TOKEN);
