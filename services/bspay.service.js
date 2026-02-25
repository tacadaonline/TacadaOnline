const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

const bspayService = {
  gerarPix: async (dados) => {
    try {
      // URL CORRETA DA DOCUMENTAÇÃO
      const url = 'https://api.bspay.co'; 
      
      const proxyUrl = process.env.FIXIE_URL;
      
      if (!proxyUrl) {
        console.error("[BSPAY] ERRO: FIXIE_URL não configurada no Render!");
        throw new Error("Configuração de Proxy ausente.");
      }

      // Criando o agente (Certifique-se que a URL no Render termina em :80)
      const agent = new HttpsProxyAgent(proxyUrl);

      // Payload ajustado conforme o seu exemplo PHP
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

      const response = await axios.post(url, body, {
        httpsAgent: agent, 
        proxy: false,      
        headers: {
          'Authorization': `Bearer ${process.env.BSPAY_TOKEN}`,
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

      if (erroStatus === 403) {
        throw new Error("IP Bloqueado pela BSPAY. Verifique os IPs do Fixie no painel deles.");
      }
      
      throw new Error(erroData?.message || "Falha na comunicação com a API.");
    }
  }
};

module.exports = bspayService;
