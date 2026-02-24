const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const bspayService = {
  gerarPix: async (dados) => {
    try {
      // 1. URL COMPLETA (Crucial para evitar o 403)
      const url = 'https://api.bspay.co'; 
      
      // 2. VALIDAÇÃO DA VARIÁVEL (Evita o erro 'undefined')
      const proxyUrl = process.env.FIXIE_URL;
      
      if (!proxyUrl) {
        console.error("[BSPAY] ERRO: Variável FIXIE_URL não encontrada no Render!");
        throw new Error("Configuração de Proxy (Fixie) ausente.");
      }

      const agent = new HttpsProxyAgent(proxyUrl);

      const config = {
        httpsAgent: agent, 
        proxy: false,      
        headers: {
          'Authorization': `Bearer ${process.env.BSPAY_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      const body = {
        payerName: dados.nome,
        payerTaxId: dados.cpf.replace(/\D/g, '') || "00000000000", 
        amount: parseFloat(dados.valor),
        postbackUrl: `https://tacadaonline-beckend.onrender.com`
      };

      console.log(`[BSPAY] Iniciando tentativa via Fixie...`);

      const response = await axios.post(url, body, config);
      return response.data;

    } catch (error) {
      const erroStatus = error.response?.status;
      const erroData = error.response?.data;

      console.error(`[BSPAY ERROR] Status: ${erroStatus}`);
      console.error("Detalhes:", erroData || error.message);

      if (erroStatus === 403) {
        // Se chegar aqui, o IP do Fixie realmente não está na Whitelist da BSPAY
        throw new Error("Erro 403: O IP do seu Fixie ainda não foi liberado no firewall da BSPAY.");
      }
      
      throw new Error(erroData?.message || "Falha na comunicação com a API de pagamento.");
    }
  }
};

module.exports = bspayService;
