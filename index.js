// ==============================
// 🎯 Backend completo Rasca y Gana (Shopify + control diario)
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
      "https://admin.shopify.com",
      /\.myshopify\.com$/,
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  })
);

const PORT = process.env.PORT || 10000; // ✅ Render usa puerto dinámico
const SHOP = process.env.SHOPIFY_STORE_URL;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.API_VERSION || "2025-10";
const BASE_URL = `https://${SHOP}/admin/api/${API_VERSION}`;

// =====================================
// 🔍 FUNCIONES AUXILIARES
// =====================================
async function getCustomerByEmail(email) {
  if (!email) return null;
  const res = await fetch(`${BASE_URL}/customers/search.json?query=email:${email}`, {
    headers: { "X-Shopify-Access-Token": TOKEN },
  });
  const data = await res.json();
  return data.customers?.[0] || null;
}

async function getCustomerById(customerId) {
  const res = await fetch(`${BASE_URL}/customers/${customerId}.json`, {
    headers: { "X-Shopify-Access-Token": TOKEN },
  });
  const data = await res.json();
  return data.customer || null;
}

async function getCustomerMetafields(customerId) {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/metafields.json`, {
    headers: { "X-Shopify-Access-Token": TOKEN },
  });
  const data = await res.json();
  return data.metafields || [];
}

async function updateMetafield(customerId, namespace, key, value, type = "number_integer") {
  const existing = await getCustomerMetafields(customerId);
  const found = existing.find(m => m.namespace === namespace && m.key === key);

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
// 💰 ENDPOINTS DE MONEDAS
// =====================================

// 📥 Consultar monedas
app.post("/consultar-monedas", async (req, res) => {
  try {
    const { email, customerId } = req.body;
    let customer = customerId
      ? await getCustomerById(customerId)
      : await getCustomerByEmail(email);

    if (!customer) return res.json({ ok: true, monedas: 0 });

    const metafields = await getCustomerMetafields(customer.id);
    let monedasField = metafields.find(m => m.key === "monedas_acumuladas");

    if (!monedasField) {
      await updateMetafield(customer.id, "custom", "monedas_acumuladas", "0");
      monedasField = { value: "0" };
    }

    const monedas = parseInt(monedasField.value) || 0;
    res.json({ ok: true, monedas });
  } catch (error) {
    console.error("❌ Error en /consultar-monedas:", error);
    res.status(500).json({ ok: false, error: "Error al consultar monedas" });
  }
});

// 💾 Actualizar monedas
app.post("/actualizar-monedas", async (req, res) => {
  try {
    const { email, customerId, monedas } = req.body;
    let customer = customerId
      ? await getCustomerById(customerId)
      : await getCustomerByEmail(email);

    if (!customer)
      return res.status(404).json({ ok: false, error: "Cliente no encontrado" });

    const metafields = await getCustomerMetafields(customer.id);
    let monedasField = metafields.find(m => m.key === "monedas_acumuladas");

    let nuevasMonedas = parseInt(monedas) || 0;
    if (monedasField) {
      nuevasMonedas = parseInt(monedasField.value) + parseInt(monedas);
    }

    await updateMetafield(customer.id, "custom", "monedas_acumuladas", nuevasMonedas.toString());
    res.json({ ok: true, monedas: nuevasMonedas });
  } catch (error) {
    console.error("❌ Error en /actualizar-monedas:", error);
    res.status(500).json({ ok: false, error: "Error al actualizar monedas" });
  }
});

// 🎟 Registrar juego (una vez por compra o por día)
app.post("/registrar-juego", async (req, res) => {
  try {
    const { email, customerId, monedasGanadas = 0 } = req.body;
    let customer = customerId
      ? await getCustomerById(customerId)
      : await getCustomerByEmail(email);

    if (!customer)
      return res.status(404).json({ ok: false, error: "Cliente no encontrado" });

    const metafields = await getCustomerMetafields(customer.id);
    const lastPlayed = metafields.find(m => m.key === "last_played");

    const hoy = new Date().toISOString().split("T")[0];

    // ❌ Si ya jugó hoy
    if (lastPlayed && lastPlayed.value === hoy) {
      return res.json({ ok: false, yaJugo: true, mensaje: "Ya jugaste por hoy." });
    }

    // ✅ Registrar fecha del juego
    await updateMetafield(customer.id, "custom", "last_played", hoy, "single_line_text_field");

    // ✅ Sumar monedas si ganó
    if (monedasGanadas > 0) {
      let monedasField = metafields.find(m => m.key === "monedas_acumuladas");
      let total = parseInt(monedasField?.value || 0) + parseInt(monedasGanadas);
      await updateMetafield(customer.id, "custom", "monedas_acumuladas", total.toString());
      return res.json({
        ok: true,
        yaJugo: false,
        mensaje: `Ganaste ${monedasGanadas} monedas`,
        monedas: total,
      });
    }

    res.json({ ok: true, yaJugo: false, mensaje: "Juego registrado correctamente." });
  } catch (error) {
    console.error("❌ Error en /registrar-juego:", error);
    res.status(500).json({ ok: false, error: "Error al registrar juego" });
  }
});

// =====================================
// ✅ PRUEBA DE VIDA
// =====================================
app.get("/", (req, res) => {
  res.send("✅ Backend Rasca y Gana activo 🚀");
});

// =====================================
// 🚀 INICIO SERVIDOR
// =====================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor iniciado correctamente en puerto ${PORT}`);
});
