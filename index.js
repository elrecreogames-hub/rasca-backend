import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// ✅ Middlewares
app.use(express.json());

// 🧩 CONFIGURACIÓN DE CORS (permitiendo Shopify)
app.use(
  cors({
    origin: [
      "https://e28zpf-2k.myshopify.com",
      "https://admin.shopify.com",
      /\.myshopify\.com$/,
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  })
);

// 🧩 VARIABLES
const PORT = process.env.PORT || 3000;
const SHOP = process.env.SHOPIFY_STORE_URL;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.API_VERSION || "2025-01";
const BASE_URL = `https://${SHOP}/admin/api/${API_VERSION}`;

// ============================
// 🧠 FUNCIONES AUXILIARES
// ============================
async function getCustomerByEmail(email) {
  console.log("🔍 Buscando cliente:", email);
  const res = await fetch(`${BASE_URL}/customers/search.json?query=email:${email}`, {
    headers: { "X-Shopify-Access-Token": TOKEN },
  });
  const data = await res.json();
  return data.customers?.[0] || null;
}

async function getOrdersByCustomer(customerId) {
  const res = await fetch(`${BASE_URL}/orders.json?customer_id=${customerId}&status=any`, {
    headers: { "X-Shopify-Access-Token": TOKEN },
  });
  const data = await res.json();
  return (data.orders || []).filter((o) => o.financial_status === "paid");
}

async function getCustomerMetafields(customerId) {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/metafields.json`, {
    headers: { "X-Shopify-Access-Token": TOKEN },
  });
  const data = await res.json();
  return data.metafields || [];
}

async function updateMetafield(customerId, namespace, key, value, type = "single_line_text_field") {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/metafields.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metafield: { namespace, key, value, type },
    }),
  });
  return await res.json();
}

// ============================
// 🎮 RUTA: Verificar si puede jugar
// ============================
app.post("/check-juego", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Falta el correo electrónico" });

    const customer = await getCustomerByEmail(email);
    if (!customer) return res.json({ puedeJugar: false, motivo: "Cliente no encontrado" });

    const orders = await getOrdersByCustomer(customer.id);
    if (!orders.length) return res.json({ puedeJugar: false, motivo: "Sin compras pagadas" });

    const lastOrder = orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const lastOrderId = lastOrder.id.toString();

    const metafields = await getCustomerMetafields(customer.id);
    const lastPlayed = metafields.find((m) => m.key === "last_played");

    if (lastPlayed && lastPlayed.value === lastOrderId) {
      return res.json({ puedeJugar: false, motivo: "Ya jugó esta compra" });
    }

    await updateMetafield(customer.id, "custom", "last_played", lastOrderId);
    res.json({ puedeJugar: true, orderId: lastOrderId });
  } catch (error) {
    console.error("❌ Error en /check-juego:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// ============================
// 💰 RUTA: Actualizar monedas
// ============================
app.post("/actualizar-monedas", async (req, res) => {
  try {
    const { email, monedas } = req.body;
    if (!email || monedas == null)
      return res.status(400).json({ error: "Faltan datos: email o monedas" });

    const customer = await getCustomerByEmail(email);
    if (!customer) return res.json({ ok: false, motivo: "Cliente no encontrado" });

    const metafields = await getCustomerMetafields(customer.id);
    let monedasField = metafields.find((m) => m.key === "monedas_acumuladas");

    const nuevasMonedas = monedasField
      ? parseInt(monedasField.value) + parseInt(monedas)
      : parseInt(monedas);

    if (monedasField) {
      await fetch(`${BASE_URL}/metafields/${monedasField.id}.json`, {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metafield: { id: monedasField.id, value: nuevasMonedas.toString() },
        }),
      });
    } else {
      await updateMetafield(customer.id, "custom", "monedas_acumuladas", nuevasMonedas.toString());
    }

    res.json({ ok: true, total: nuevasMonedas });
  } catch (error) {
    console.error("❌ Error en /actualizar-monedas:", error);
    res.status(500).json({ error: "Error al actualizar monedas" });
  }
});

// ============================
// 🌐 RUTA: Consultar monedas del usuario
// ============================
app.post("/consultar-monedas", async (req, res) => {
  try {
    console.log("📩 POST /consultar-monedas", req.body);
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: "Falta el correo electrónico" });

    const customer = await getCustomerByEmail(email);
    if (!customer) return res.json({ ok: false, motivo: "Cliente no encontrado" });

    const metafields = await getCustomerMetafields(customer.id);
    const monedasField = metafields.find((m) => m.key === "monedas_acumuladas");

    const monedas = monedasField ? parseInt(monedasField.value) : 0;
    res.json({ ok: true, monedas });
  } catch (error) {
    console.error("❌ Error en /consultar-monedas:", error);
    res.status(500).json({ error: "Error al consultar monedas" });
  }
});

// ============================
// ✅ PRUEBA DE VIDA
// ============================
app.get("/", (req, res) => {
  res.send("✅ Backend Rasca y Gana activo 🚀");
});

// ============================
// 🚀 INICIO DEL SERVIDOR
// ============================
app.listen(PORT, () => {
  console.log(`✅ Servidor iniciado en puerto ${PORT}`);
});
