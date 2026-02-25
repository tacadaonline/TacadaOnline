const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

let bspayAccessToken = null;
let bspayTokenExpira = 0;

async function obterTokenBspay(agent) {
    if (bspayAccessToken && Date.now() < bspayTokenExpira) {
        return bspayAccessToken;
    }

    console.log("[BSPAY] 🔑 Gerando novo access_token...");

    const response = await axios.post('https://api.bspay.co/v2/oauth/token', {
        client_id: process.env.BSPAY_CLIENT_ID,
        client_secret: process.env.BSPAY_CLIENT_SECRET,
        grant_type: 'client_credentials'
    }, {
        httpsAgent: agent,
        proxy: false,
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
    });

    bspayAccessToken = response.data.access_token;
    bspayTokenExpira = Date.now() + ((response.data.expires_in - 300) * 1000);

    console.log("[BSPAY] ✅ Access token obtido com sucesso!");
    return bspayAccessToken;
}

const bspayService = {
  gerarPix: async (dados) => {
    try {
      const proxyUrl = process.env.FIXIE_URL;
      
      if (!proxyUrl) {
        console.error("[BSPAY] ERRO: FIXIE_URL não configurada no Render!");
        throw new Error("Configuração de Proxy ausente.");
      }

      const agent = new HttpsProxyAgent(proxyUrl);

      const accessToken = await obterTokenBspay(agent);

      const body = {
        amount: parseFloat(dados.valor),
        external_id: crypto.randomBytes(8).toString('hex'), 
        payerQuestion: "Deposito Jogo", 
        payer: {
          name: dados.username || "Usuario Jogo",
          document: (dados.cpf || "00000000000").replace(/\D/g, ''),
          email: dados.email || `${dados.username}@email.com`
        },
        postbackUrl: "https://tacadaonline-beckend.onrender.com"
      };

      console.log(`[BSPAY] Tentando gerar PIX via Fixie...`);

      const response = await axios.post('https://api.bspay.co/v2/pix/qrcode', body, {
        httpsAgent: agent, 
        proxy: false,      
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0' 
        },
        timeout: 15000
      });

      return response.data;

    } catch (error) {
      const erroStatus = error.response?.status;
      const erroData = error.response?.data;

      console.error(`[BSPAY ERROR] Status: ${erroStatus}`);
      console.error("Detalhes:", JSON.stringify(erroData) || error.message);

      if (erroStatus === 401) {
        bspayAccessToken = null;
        bspayTokenExpira = 0;
      }

      if (erroStatus === 403) {
        throw new Error("IP Bloqueado pela BSPAY. Verifique os IPs do Fixie no painel deles.");
      }
      
      throw new Error(erroData?.message || "Falha na comunicação com a API.");
    }
  }
};

module.exports = bspayService;
