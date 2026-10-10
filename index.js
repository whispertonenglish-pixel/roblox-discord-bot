require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const {
    Client, GatewayIntentBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    EmbedBuilder
} = require('discord.js');

const pendingCodes = new Map();
const linkedAccounts = new Map();

// --- KONFIGURÁCIÓ ---
const LOG_CHANNEL_ID = "1558482103622967476"; 

const app = express();
app.use(express.json());

app.post('/api/generate-code', (req, res) => {
    if (req.headers['x-api-key'] !== process.env.ROBLOX_SECRET_KEY) return res.status(401).send();
    const { robloxUserId, robloxUsername } = req.body;
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    pendingCodes.set(code, { robloxUserId: String(robloxUserId), robloxUsername, createdAt: Date.now() });
    res.json({ code, expiresIn: 300 });
});

app.get('/api/check-link/:robloxUserId', (req, res) => {
    const robloxUserId = String(req.params.robloxUserId);
    const linked = Array.from(linkedAccounts.values()).includes(robloxUserId);
    res.json({ linked });
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

        linkedAccounts.set(interaction.user.id, data.robloxUserId);
        pendingCodes.delete(enteredCode);

        // --- A KÉRT MÓDOSÍTOTT SIKER ÜZENET ---
        await interaction.reply({ content: 'Sikeresen összekötötted a Roblox fiókodat!', ephemeral: true });

        // LOG KÜLDÉSE A CSATORNÁBA
        try {
            const channel = await client.channels.fetch(LOG_CHANNEL_ID);
            if (channel) {
                const log = new EmbedBuilder()
                    .setTitle('Fiók összekapcsolás')
                    .addFields(
                        { name: 'Roblox név', value: `${data.robloxUsername}`, inline: true },
                        { name: 'Roblox ID', value: `${data.robloxUserId}`, inline: true },
                        { name: 'Discord felhasználó', value: `${interaction.user.tag} (${interaction.user.id})` },
                        { name: 'Dátum', value: new Date().toLocaleString('hu-HU') }
                    )
                    .setColor(0x000000);
                await channel.send({ embeds: [log] });
            }
        } catch (e) { console.log(e); }
    }
});

client.on('messageCreate', async (m) => {
    if (m.content === '!panel' && !m.author.bot) {
        const embed = new EmbedBuilder()
            .setTitle('Fiók összekötés')
            .setDescription(
                "A Roblox-fiókok összekötésének elsődleges célja a biztonság növelése, a gyanús tevékenységek felismerése és a közösség védelme. A rendszer segítségével bizonyos, a fiókhoz kapcsolódó információkat tudunk ellenőrizni és elemezni annak érdekében, hogy időben felismerhessük a potenciális veszélyeket.\n\n" +
                "A megfelelően kialakított ellenőrzési rendszer segíthet a gyanús fióktevékenységek, a jogosulatlan hozzáférési kísérletek, a csalások és az egyéb rosszindulatú műveletek kiszűrésében. Az összegyűjtött, engedélyezetten hozzáférhető információk alapján könnyebben azonosíthatók azok a minták, amelyek potenciális biztonsági kockázatra utalhatnak."
            )
            .setColor(0x000000);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('link_button')
                .setLabel('Összekötés')
                .setStyle(ButtonStyle.Secondary)
        );

        await m.channel.send({ embeds: [embed], components: [row] });
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
