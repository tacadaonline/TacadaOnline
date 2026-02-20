require('dotenv').config(); // 1. CARREGA O DOTENV NO TOPO
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

// 2. USE AS VARIÁVEIS DO .env PARA SEGURANÇA
const SUITPAY_ID = process.env.SUITPAY_ID;
const SUITPAY_SECRET = process.env.SUITPAY_SECRET;
const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_PASSWORD_FIXA = process.env.ADMIN_PASS || "mude-isso-no-env"; 

let globalRTP = 0.95; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ BANCO CONECTADO!"))
    .catch(err => console.error("❌ ERRO BANCO:", err));

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 }
});
const User = mongoose.model("User", UserSchema);

// --- ✅ LOGICA DE APOSTA SEGURA (SERVER-SIDE) ---
app.post("/api/aposta", async (req, res) => {
    try {
        const { username, valor } = req.body;
        const valorAposta = parseFloat(valor);

        if (!username || isNaN(valorAposta) || valorAposta <= 0) {
            return res.status(400).json({ success: false, message: "Dados inválidos" });
        }

        const usuario = await User.findOne({ username: username.trim().toLowerCase() });
        if (!usuario || usuario.saldo < valorAposta) {
            return res.status(400).json({ success: false, message: "Saldo insuficiente" });
        }

        // --- 🎲 O SERVIDOR DECIDE O RESULTADO (ANTI-HACK) ---
        const sorteio = Math.random();
        const ganhou = sorteio < globalRTP; // Se RTP é 0.95, tem 95% de chance de "retorno"
        
        let mudancaSaldo = -valorAposta;
        let resultadoTexto = "perdeu";

        if (ganhou) {
            // Exemplo: se ganhar, dobra o valor (ajuste conforme seu jogo)
            mudancaSaldo = valorAposta * 3; 
            resultadoTexto = "ganhou";
        }

        // Atualiza o saldo de forma atômica para evitar bugs de concorrência
        const usuarioAtualizado = await User.findOneAndUpdate(
            { username: username.trim().toLowerCase() },
            { $inc: { saldo: mudancaSaldo } },
            { new: true }
        );

        res.json({ 
            success: true, 
            saldo: usuarioAtualizado.saldo,
            resultado: resultadoTexto,
            ganhou: ganhou
        });

    } catch (err) { 
        res.status(500).json({ success: false, message: "Erro interno no servidor" }); 
    }
});

// --- ADMIN E OUTROS (MANTIDOS COM SEGURANÇA) ---
app.post("/admin/add-saldo", async (req, res) => {
    const { username, valor, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    
    const usuario = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase() }, 
        { $inc: { saldo: parseFloat(valor) } }, 
        { new: true }
    );
    res.json({ success: true, novoSaldo: usuario?.saldo });
});

// ... (Mantenha as rotas de Login e Register que já usam bcrypt)

app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log("🚀 BACKEND SEGURO RODANDO"));
