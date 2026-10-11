require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg'); // PostgreSQL modul a végleges mentéshez

const app = express();
app.use(express.json());

// --- ADATBÁZIS CSATLAKOZÁS ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Tábla létrehozása az induláskor
pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT PRIMARY KEY,
        roles TEXT[]
    )
`);

const pendingCodes = new Map();
const sessionStatus = new Map();
const LOG_CHANNEL_ID = "1558482103622967476";
const PROTECTED_ROLES = [
    "1528419594639904921",
    "1540106841831251978",
    "1398739258084298794",
    "1398739305773404231",
    "1398739314875043971"
];

// --- ROBLOX API ---
app.post('/api/generate-code', (req, res) => {
    if (req.headers['x-api-key'] !== process.env.ROBLOX_SECRET_KEY) return res.status(401).send();
    const { robloxUserId, robloxUsername } = req.body;
    const rId = String(robloxUserId);
    sessionStatus.set(rId, false);
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    pendingCodes.set(code, { robloxUserId: rId, robloxUsername, createdAt: Date.now() });
    res.json({ code, expiresIn: 300 });
});

app.get('/api/check-link/:robloxUserId', (req, res) => {
    res.json({ linked: sessionStatus.get(String(req.params.robloxUserId)) || false });
});

app.listen(process.env.PORT || 3000);

// --- DISCORD BOT ---
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});

client.on('ready', () => console.log(`✅ Bot online: ${client.user.tag}`));

// RANGOK MENTÉSE (Adatbázisba, nem fájlba!)
client.on('guildMemberRemove', async (member) => {
    const rolesToSave = member.roles.cache
        .filter(role => PROTECTED_ROLES.includes(role.id))
        .map(role => role.id);

    if (rolesToSave.length > 0) {
        await pool.query(
            'INSERT INTO user_roles (user_id, roles) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET roles = $2',
            [member.id, rolesToSave]
        );
        console.log(`[ADATBÁZIS MENTÉS] ${member.user.tag} rangjai elmentve.`);
    }
});

// RANGOK VISSZAADÁSA (Adatbázisból!)
client.on('guildMemberAdd', async (member) => {
    try {
        const res = await pool.query('SELECT roles FROM user_roles WHERE user_id = $1', [member.id]);
        
        if (res.rows.length > 0) {
            const rolesToAdd = res.rows[0].roles;
            await member.roles.add(rolesToAdd);
            console.log(`[ADATBÁZIS VISSZAADÁS] ${member.user.tag} visszakapta a rangjait.`);
            
            const channel = await client.channels.fetch(LOG_CHANNEL_ID);
            if (channel) {
                await channel.send({ content: `**${member.user.tag}** visszatért, a védett rangjai automatikusan visszaállítva.` });
            }
        }
    } catch (err) {
        console.error("Hiba a rangok visszaadásakor:", err);
    }
});

// MODAL ÉS PANEL KEZELŐ (A tegnapi kód)
client.on('interactionCreate', async (i) => {
    if (i.isButton() && i.customId === 'link_button') {
        const modal = new ModalBuilder().setCustomId('link_modal').setTitle('Fiók összekötés');
        const input = new TextInputBuilder().setCustomId('link_code').setLabel('Kód').setStyle(TextInputStyle.Short).setMinLength(6).setMaxLength(6).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await i.showModal(modal);
    }
    if (i.isModalSubmit() && i.customId === 'link_modal') {
        const enteredCode = i.fields.getTextInputValue('link_code').trim().toUpperCase();
        const data = pendingCodes.get(enteredCode);
        if (!data) return i.reply({ content: 'Hiba: Érvénytelen kód!', ephemeral: true });
        sessionStatus.set(data.robloxUserId, true);
        pendingCodes.delete(enteredCode);
        await i.reply({ content: 'Sikeresen összekötötted a Roblox fiókodat!', ephemeral: true });
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
