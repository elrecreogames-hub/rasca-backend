// ==============================
// 🎯 Backend Rasca y Gana (1 juego por compra automático)
// ==============================
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// =====================================
// ⚙️ CONFIGURACIÓN
// =====================================
app.use(express.json());
app.use(
  cors({
    origin: [
      "https://e28zpf-2k.myshopify.com",
      /\.myshopify\.com$/,
      "https://admin.shopify.com",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  })
);

const PORT = process.env.PORT || 10000;
const SHOP = process.env.SHOPIFY_STORE_URL;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.API_VERSION || "2025-10";
const BASE_URL = `https://${SHOP}/admin/api/${API_VERSION}`;

// =====================================
// 🔧 FUNCIONES AUXILIARES
// =====================================
async function getCustomerByEmail(email) {
  if (!email) return null;
  const res = await fetch(`${BASE_URL}/customers/search.json?query=email:${email}`, {
    headers: { "X-Shopify-Access-Token": TOKEN },
  });
  const data = await res.json();
  return data.customers?.[0] || null;
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
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  const found = data.metafields.find(m => m.namespace === namespace && m.key === key);

  if (found) {
    await fetch(`${BASE_URL}/metafields/${found.id}.json`, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metafield: { id: found.id, value } }),
    });
  } else {
    await fetch(`${BASE_URL}/customers/${customerId}/metafields.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metafield: { namespace, key, value, type } }),
    });
  }
}

// =====================================
// 🧠 LÓGICA DEL JUEGO
// =====================================

// 🔎 Verificar si puede jugar (1 vez por compra)
app.post("/check-juego", async (req, res) => {
  try {
    const { email, orderId } = req.body;
    const customer = await getCustomerByEmail(email);
    if (!customer) return res.json({ puedeJugar: false, mensaje: "Cliente no encontrado" });

    const metafields = await getCustomerMetafields(customer.id);
    const jugadas = metafields.find(m => m.key === "compras_jugadas");
    const jugadasPrevias = jugadas?.value ? jugadas.value.split(",") : [];

    // Si ya jugó esa compra
    if (jugadasPrevias.includes(orderId.toString())) {
      return res.json({ puedeJugar: false, mensaje: "Ya jugaste con esta compra" });
    }

    return res.json({ puedeJugar: true });
  } catch (error) {
    console.error("❌ Error en /check-juego:", error);
    res.status(500).json({ puedeJugar: false, error: "Error interno" });
  }
});

// 🎯 Registrar juego y actualizar monedas
app.post("/registrar-juego", async (req, res) => {
  try {
    const { email, orderId, monedasGanadas = 0 } = req.body;
    if (!email || !orderId)
      return res.status(400).json({ ok: false, error: "Faltan datos" });

    const customer = await getCustomerByEmail(email);
    if (!customer)
      return res.status(404).json({ ok: false, error: "Cliente no encontrado" });

    const metafields = await getCustomerMetafields(customer.id);
    const jugadas = metafields.find(m => m.key === "compras_jugadas");
    const jugadasPrevias = jugadas?.value ? jugadas.value.split(",") : [];

    // Si ya jugó con esa compra
    if (jugadasPrevias.includes(orderId.toString())) {
      return res.json({ ok: false, yaJugo: true, mensaje: "Ya jugaste con esta compra." });
    }

    // Registrar la compra como jugada
    jugadasPrevias.push(orderId.toString());
    await updateMetafield(customer.id, "custom", "compras_jugadas", jugadasPrevias.join(","), "multi_line_text_field");

    // Sumar monedas
    const monedasField = metafields.find(m => m.key === "monedas_acumuladas");
    const total = (parseInt(monedasField?.value || 0) + parseInt(monedasGanadas)).toString();
    await updateMetafield(customer.id, "custom", "monedas_acumuladas", total, "number_integer");

    res.json({
      ok: true,
      yaJugo: false,
      mensaje: `Ganaste ${monedasGanadas} monedas 🎉`,
      monedas: parseInt(total),
    });
  } catch (error) {
    console.error("❌ Error en /registrar-juego:", error);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

// 💰 Consultar monedas
app.post("/consultar-monedas", async (req, res) => {
  try {
    const { email } = req.body;
    const customer = await getCustomerByEmail(email);
    if (!customer) return res.json({ ok: true, monedas: 0 });

    const metafields = await getCustomerMetafields(customer.id);
    const monedasField = metafields.find(m => m.key === "monedas_acumuladas");
    const monedas = monedasField ? parseInt(monedasField.value) : 0;

    res.json({ ok: true, monedas });
  } catch (error) {
    console.error("❌ Error en /consultar-monedas:", error);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

// ✅ Prueba de vida
app.get("/", (req, res) => {
  res.send("✅ Backend Rasca y Gana activo — 1 juego por compra automático 🚀");
});

app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Servidor escuchando en puerto ${PORT}`)
);
