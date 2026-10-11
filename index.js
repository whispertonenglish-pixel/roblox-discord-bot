require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs'); // Fájlkezelő az adatok mentéséhez
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');

const app = express();
app.use(express.json());

const pendingCodes = new Map();
const sessionStatus = new Map();
const LOG_CHANNEL_ID = "1558482103622967476";

// --- RANG MENTÉS KONFIGURÁCIÓ ---
const PROTECTED_ROLES = [
    "1528419594639904921",
    "1540106841831251978",
    "1398739258084298794",
    "1398739305773404231",
    "1398739314875043971"
];

// Adatok betöltése fájlból (hogy újraindításnál ne vesszen el minden)
let savedRoles = {};
if (fs.existsSync('saved_roles.json')) {
    savedRoles = JSON.parse(fs.readFileSync('saved_roles.json', 'utf8'));
}

function saveToFile() {
    fs.writeFileSync('saved_roles.json', JSON.stringify(savedRoles, null, 2));
}

// --- ROBLOX API RÉSZ ---
app.post('/api/generate-code', (req, res) => {
    if (req.headers['x-api-key'] !== process.env.ROBLOX_SECRET_KEY) return res.status(401).send();
    const { robloxUserId, robloxUsername } = req.body;
    const rId = String(robloxUserId);
    sessionStatus.set(rId, false);
    for (const [c, data] of pendingCodes.entries()) {
        if (data.robloxUserId === rId) pendingCodes.delete(c);
    }
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    pendingCodes.set(code, { robloxUserId: rId, robloxUsername, createdAt: Date.now() });
    res.json({ code, expiresIn: 300 });
});

app.get('/api/check-link/:robloxUserId', (req, res) => {
    res.json({ linked: sessionStatus.get(String(req.params.robloxUserId)) || false });
});

app.listen(process.env.PORT || 3000);

// --- DISCORD BOT RÉSZ ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // EZ KELL A RANGOKHOZ ÉS A BELÉPÉSHEZ
    ]
});

client.on('ready', () => console.log(`✅ Bot online: ${client.user.tag}`));

// 1. ESEMÉNY: Valaki kilép a szerverről
client.on('guildMemberRemove', (member) => {
    // Megnézzük, van-e neki a védett rangok közül
    const rolesToSave = member.roles.cache
        .filter(role => PROTECTED_ROLES.includes(role.id))
        .map(role => role.id);

    if (rolesToSave.length > 0) {
        savedRoles[member.id] = rolesToSave;
        saveToFile();
        console.log(`[RANG MENTÉS] ${member.user.tag} kilépett, mentett rangok: ${rolesToSave.join(', ')}`);
    }
});

// 2. ESEMÉNY: Valaki belép a szerverre
client.on('guildMemberAdd', async (member) => {
    if (savedRoles[member.id]) {
        const rolesToAdd = savedRoles[member.id];
        
        try {
            await member.roles.add(rolesToAdd);
            console.log(`[RANG VISSZAADÁS] ${member.user.tag} visszakapta a rangjait.`);
            
            // Logoljuk a csatornába is
            const channel = await client.channels.fetch(LOG_CHANNEL_ID);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('Rang visszaállítva')
                    .setDescription(`**${member.user.tag}** visszatért és automatikusan visszakapta a rangjait.`)
                    .addFields({ name: 'Visszaadott ID-k', value: rolesToAdd.join('\n') })
                    .setColor(0x3498DB);
                await channel.send({ embeds: [embed] });
            }
            
            // Opcionális: Töröljük a mentésből, ha már visszakapta (vagy hagyd bent, ha biztosra mész)
            // delete savedRoles[member.id];
            // saveToFile();

        } catch (err) {
            console.error(`Hiba a rang visszaadásakor (${member.user.tag}):`, err);
        }
    }
});

// --- A TEGNAPI MODAL ÉS PANEL KEZELŐ ---
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
        sessionStatus.set(data.robloxUserId, true);
        pendingCodes.delete(enteredCode);
        await interaction.reply({ content: 'Sikeresen összekötötted a Roblox fiókodat!', ephemeral: true });
        try {
            const channel = await client.channels.fetch(LOG_CHANNEL_ID);
            if (channel) {
                const log = new EmbedBuilder().setTitle('Fiók összekapcsolás').addFields({ name: 'Roblox név', value: `${data.robloxUsername}`, inline: true }, { name: 'Roblox ID', value: `${data.robloxUserId}`, inline: true }, { name: 'Discord', value: `${interaction.user.tag}` }).setColor(0x000000);
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
