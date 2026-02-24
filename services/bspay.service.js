const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const bspayService = {
  gerarPix: async (dados) => {
    try {
      // AJUSTE 1: A URL correta para gerar PIX é /v2/pix/qrcode
      const url = 'https://api.bspay.co'; 
      
      const proxyUrl = process.env.FIXIE_URL;
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

      // AJUSTE 2: A BSPAY exige 'payerName', 'payerTaxId' e 'amount'
      const body = {
        payerName: dados.nome, // Nome do cliente
        payerTaxId: dados.cpf.replace(/\D/g, '') || "00000000000", // CPF limpo
        amount: parseFloat(dados.valor), // A API usa 'amount', não 'value'
        postbackUrl: `https://tacadaonline-beckend.onrender.com`
      };

      console.log(`[BSPAY] Enviando via Fixie (IP Estático) para: ${url}`);

      const response = await axios.post(url, body, config);
      return response.data;

    } catch (error) {
      const erroStatus = error.response?.status;
      const erroData = error.response?.data;

      console.error(`[BSPAY ERROR] Status: ${erroStatus}`);
      console.error("Detalhes da BSPAY:", erroData || error.message);

      if (erroStatus === 403) {
        throw new Error("Erro 403: Verifique se os IPs do Fixie (52.5.155.132 / 52.87.82.133) foram liberados na BSPAY.");
      }
      
      throw new Error(erroData?.message || "Falha na comunicação com a API de pagamento.");
    }
  }
};

module.exports = bspayService;
