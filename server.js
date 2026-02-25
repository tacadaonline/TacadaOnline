require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

// --- MODIFICAÇÃO 1: IMPORTAR AXIOS E O PROXY AGENT ---
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

// --- MODIFICAÇÃO 2: CONFIGURAR O AGENTE DO FIXIE ---
// Certifique-se de adicionar a variável FIXIE_URL no painel do Render
const proxyUrl = process.env.FIXIE_URL;
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_PASSWORD_FIXA = process.env.ADMIN_PASS || "mude-isso-no-env"; 
let globalRTP = 0.30; 

mongoose.connect(MONGO_URI).then(() => console.log("✅ BANCO CONECTADO")).catch(err => console.error("❌ ERRO BANCO:", err));

// ... (Seus SCHEMAS User e Saque continuam iguais aqui) ...

// --- MODIFICAÇÃO 3: ROTA PARA GERAR PIX VIA BSPAY ---
app.post("/api/gerar-pix", async (req, res) => {
    const { username, valor } = req.body;

    try {
        // 1. Verificar se o usuário existe
        const user = await User.findOne({ username: username.trim().toLowerCase() });
        if (!user) return res.status(404).json({ success: false, message: "Usuário não encontrado" });

        // 2. Chamar a API da BSPAY usando o Proxy
        // Ajuste a URL e o Body conforme a documentação da BSPAY
        const response = await axios.post('https://api.bspay.co', {
            amount: valor,
            external_id: crypto.randomBytes(8).toString('hex'),
            payer: {
                name: user.username,
                document: "00000000000" // Exemplo, ajuste conforme seu formulário
            }
        }, {
            httpsAgent: agent, // USA O IP FIXO DO FIXIE AQUI
            proxy: false,
            headers: {
                'Authorization': `Bearer ${process.env.BSPAY_TOKEN}`, // Seu token no .env
                'Content-Type': 'application/json'
            }
        });

        res.json({ success: true, pix: response.data });
    } catch (error) {
        console.error("[BSPAY ERROR] Status:", error.response?.status);
        console.error("Detalhes:", error.response?.data || error.message);
        
        if (error.response?.status === 403) {
            return res.status(403).json({ 
                success: false, 
                message: "Erro 403: Verifique se os IPs do Fixie foram liberados no painel da BSPAY." 
            });
        }
        res.status(500).json({ success: false, message: "Erro ao gerar PIX" });
    }
});

// ... (Restante das suas rotas /api/register, /api/login, /api/aposta, etc continuam iguais) ...

app.listen(process.env.PORT || 10000, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${process.env.PORT || 10000}`);
});
