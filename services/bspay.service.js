const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const bspayService = {
  gerarPix: async (dados) => {
    try {
      // CORREÇÃO: A URL precisa do path completo para não dar 403
      const url = 'https://api.bspay.co'; 
      
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
          'User-Agent': 'Bspay-Integration-NodeJS/1.0' 
        }
      };

      const body = {
        payerName: dados.nome,
        payerTaxId: dados.cpf.replace(/\D/g, '') || "00000000000", 
        amount: parseFloat(dados.valor),
        postbackUrl: `https://tacadaonline-beckend.onrender.com`
      };

      console.log(`[BSPAY] Enviando requisição via Fixie para: ${url}`);

      const response = await axios.post(url, body, config);
      return response.data;

    } catch (error) {
      const erroStatus = error.response?.status;
      const erroData = error.response?.data;

      console.error(`[BSPAY ERROR] Status: ${erroStatus}`);
      console.error("Detalhes:", erroData || error.message);

      if (erroStatus === 403) {
        throw new Error("Erro 403: Verifique se os IPs do Fixie foram liberados no painel da BSPAY.");
      }
      
      throw new Error(erroData?.message || "Falha na comunicação com a API.");
    }
  }
};

module.exports = bspayService;
