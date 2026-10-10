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

// ─── 1. API Szerver ─────────────────────────────
const app = express();
app.use(express.json());

app.post('/api/generate-code', (req, res) => {
    if (req.headers['x-api-key'] !== process.env.ROBLOX_SECRET_KEY) {
        console.log('❌ Hibás titkos kulcs a Roblox felől!');
        return res.status(401).json({ error: 'Hibás titkos kulcs!' });
    }

    const { robloxUserId } = req.body;
    if (!robloxUserId) return res.status(400).json({ error: 'Hiányzó robloxUserId' });

    const code = crypto.randomBytes(3).toString('hex').toUpperCase();

    pendingCodes.set(code, {
        robloxUserId: String(robloxUserId),
        createdAt: Date.now()
    });

    console.log(`[KÓD GENERÁLVA] Roblox ID: ${robloxUserId} -> Kód: ${code}`);
    res.json({ code, expiresIn: 300 });
});

app.listen(process.env.PORT, () => {
    console.log(`🚀 API Szerver fut a ${process.env.PORT}-es porton.`);
});

// ─── 2. Discord Bot ─────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

function getPanelData() {
    const embed = new EmbedBuilder()
        .setTitle('🔗 Roblox – Discord Fiókösszekötés')
        .setDescription(
            '**Hogyan kösd össze a fiókodat?**\n\n' +
            '1️⃣ Lépj be a Roblox játékba.\n' +
            '2️⃣ Jegyezd meg a képernyőn látható **6 jegyű kódot**.\n' +
            '3️⃣ Kattints az alábbi gombra, és írd be ide!\n\n' +
            '⏱ *A kód 5 percig érvényes.*'
        )
        .setColor(0x5865F2);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('link_button')
            .setLabel('Fiókok összekötése')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔗')
    );

    return { embeds: [embed], components: [row] };
}

client.on('ready', async () => {
    console.log(`✅ Discord Bot bejelentkezve: ${client.user.tag}`);

    // Automatikus keresés induláskor
    for (const [, guild] of client.guilds.cache) {
        console.log(`🔍 Keresés a szerveren: ${guild.name}...`);
        
        // Megkeressük az összekötés csatornát
        const targetChannel = guild.channels.cache.find(
            ch => (ch.name.includes('összekötés') || ch.name.includes('osszekotes') || ch.name.includes('link')) && ch.type === ChannelType.GuildText
        );

        if (targetChannel) {
            try {
                await targetChannel.send(getPanelData());
                console.log(`🎉 SIKER! Üzenet kirakva a #${targetChannel.name} csatornába!`);
            } catch (err) {
                console.log(`❌ Nem sikerült üzenetet küldeni ide: #${targetChannel.name}. Jogosultság hiba: ${err.message}`);
            }
        } else {
            console.log(`⚠️ Nem találtam 'összekötés' nevű csatornát a(z) ${guild.name} szerveren.`);
            console.log(`👉 Írd be bármelyik csatornába a Discordon, hogy "!panel", és oda fogja kirakni!`);
        }
    }
});

// Parancs kézi kiküldéshez: !panel
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.trim() === '!panel') {
        try {
            await message.channel.send(getPanelData());
            console.log(`📨 Panel sikeresen kiküldve kézzel a #${message.channel.name} csatornába!`);
        } catch (err) {
            console.log(`❌ Hiba a kézi küldésnél: ${err.message}`);
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId === 'link_button') {
        const modal = new ModalBuilder()
            .setCustomId('link_modal')
            .setTitle('Roblox összekötés');

        const input = new TextInputBuilder()
            .setCustomId('link_code')
            .setLabel('Roblox játékban kapott kód:')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('pl. 4F8A2D')
            .setMaxLength(6)
            .setMinLength(6)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'link_modal') {
        const enteredCode = interaction.fields.getTextInputValue('link_code').trim().toUpperCase();
        const codeData = pendingCodes.get(enteredCode);

        if (!codeData) {
            return interaction.reply({ content: '❌ **Érvénytelen kód!** Lehet, hogy elgépelted?', flags: [64] });
        }

        if (Date.now() - codeData.createdAt > 5 * 60 * 1000) {
            pendingCodes.delete(enteredCode);
            return interaction.reply({ content: '⏰ **A kód lejárt!** Lépj be újra a játékba!', flags: [64] });
        }

        pendingCodes.delete(enteredCode);
        linkedAccounts.set(interaction.user.id, codeData.robloxUserId);

        console.log(`🎉 ÖSSZEKÖTVE! Discord: ${interaction.user.tag} <-> Roblox ID: ${codeData.robloxUserId}`);

        return interaction.reply({
            content: `✅ **Sikeres összekötés!**\nA Discord fiókod össze lett kapcsolva a Roblox fiókoddal (ID: \`${codeData.robloxUserId}\`).`,
            flags: [64]
        });
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);