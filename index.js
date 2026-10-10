require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const {
    Client, GatewayIntentBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    EmbedBuilder, ChannelType
} = require('discord.js');

const pendingCodes = new Map();
const linkedAccounts = new Map();

const LOG_CHANNEL_ID = "1558482103622967476"; // A te általad megadott csatorna ID

// ─── 1. API Szerver ─────────────────────────────
const app = express();
app.use(express.json());

app.post('/api/generate-code', (req, res) => {
    if (req.headers['x-api-key'] !== process.env.ROBLOX_SECRET_KEY) {
        return res.status(401).json({ error: 'Hibás titkos kulcs!' });
    }

    const { robloxUserId, robloxUsername } = req.body;
    if (!robloxUserId) return res.status(400).json({ error: 'Hiányzó adatok' });

    const code = crypto.randomBytes(3).toString('hex').toUpperCase();

    pendingCodes.set(code, {
        robloxUserId: String(robloxUserId),
        robloxUsername: robloxUsername || "Ismeretlen",
        createdAt: Date.now()
    });

    console.log(`[KÓD] ${robloxUsername} -> ${code}`);
    res.json({ code, expiresIn: 300 });
});

app.get('/api/check-link/:robloxUserId', (req, res) => {
    const robloxUserId = String(req.params.robloxUserId);
    for (const [discordId, rId] of linkedAccounts.entries()) {
        if (rId === robloxUserId) return res.json({ linked: true });
    }
    res.json({ linked: false });
});

app.listen(process.env.PORT || 3000, () => console.log(`🚀 Szerver fut.`));

// ─── 2. Discord Bot ─────────────────────────────
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on('ready', () => console.log(`✅ Bot online: ${client.user.tag}`));

// Kézi panel parancs
client.on('messageCreate', async (m) => {
    if (m.content === '!panel') {
        const embed = new EmbedBuilder().setTitle('🔗 Fiók Összekötés').setDescription('Kattints a gombra az összekötéshez!').setColor(0x5865F2);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('link_button').setLabel('Fiókok összekötése').setStyle(ButtonStyle.Primary).setEmoji('🔗'));
        await m.channel.send({ embeds: [embed], components: [row] });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId === 'link_button') {
        const modal = new ModalBuilder().setCustomId('link_modal').setTitle('Roblox összekötés');
        const input = new TextInputBuilder().setCustomId('link_code').setLabel('Kód:').setStyle(TextInputStyle.Short).setMinLength(6).setMaxLength(6).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'link_modal') {
        const enteredCode = interaction.fields.getTextInputValue('link_code').trim().toUpperCase();
        const codeData = pendingCodes.get(enteredCode);

        if (!codeData) return interaction.reply({ content: '❌ Érvénytelen kód!', ephemeral: true });

        pendingCodes.delete(enteredCode);
        linkedAccounts.set(interaction.user.id, codeData.robloxUserId);

        // ✅ SIKERES VISSZAJELZÉS A JÁTÉKOSNAK
        await interaction.reply({ content: '✅ Sikeresen összekötötted a fiókodat!', ephemeral: true });

        // 📝 LOG KÜLDÉSE A CSATORNÁBA
        try {
            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
            if (logChannel) {
                const now = new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });
                const logEmbed = new EmbedBuilder()
                    .setTitle('📥 Új fiók összekapcsolás')
                    .addFields(
                        { name: '👤 Roblox Név', value: `\`${codeData.robloxUsername}\``, inline: true },
                        { name: '🆔 Roblox ID', value: `\`${codeData.robloxUserId}\``, inline: true },
                        { name: '🔵 Discord Név', value: `${interaction.user.tag} (${interaction.user})`, inline: false },
                        { name: '⏰ Időpont', value: `\`${now}\``, inline: false }
                    )
                    .setColor(0x2ECC71) // Zöld szín
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] });
            }
        } catch (err) {
            console.error("Hiba a log küldésekor:", err);
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
