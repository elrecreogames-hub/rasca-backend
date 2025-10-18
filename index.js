import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import localtunnel from "localtunnel";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const SHOP = process.env.SHOPIFY_STORE_URL;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.API_VERSION || "2025-01";

const BASE_URL = `https://${SHOP}/admin/api/${API_VERSION}`;

// 🧩 FUNCIONES AUXILIARES
async function getCustomerByEmail(email) {
  const res = await fetch(`${BASE_URL}/customers/search.json?query=email:${email}`, {
    headers: { "X-Shopify-Access-Token": TOKEN }
  });
  const data = await res.json();
  return data.customers?.[0] || null;
}

async function getOrdersByCustomer(customerId) {
  const res = await fetch(`${BASE_URL}/orders.json?customer_id=${customerId}&status=any`, {
    headers: { "X-Shopify-Access-Token": TOKEN }
  });
  const data = await res.json();
  // 🟢 Solo pedidos pagados
  return (data.orders || []).filter(o => o.financial_status === "paid");
}

async function getCustomerMetafields(customerId) {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/metafields.json`, {
    headers: { "X-Shopify-Access-Token": TOKEN }
  });
  const data = await res.json();
  return data.metafields || [];
}

async function updateMetafield(customerId, namespace, key, value, type = "single_line_text_field") {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/metafields.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      metafield: { namespace, key, value, type }
    })
  });
  return await res.json();
}

// 🟢 RUTA 1: Verificar si puede jugar
app.post("/check-juego", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Falta el correo" });

    const customer = await getCustomerByEmail(email);
    if (!customer) return res.json({ puedeJugar: false, motivo: "Cliente no encontrado" });

    const orders = await getOrdersByCustomer(customer.id);
    if (!orders.length) return res.json({ puedeJugar: false, motivo: "Sin compras pagadas" });

    const lastOrder = orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const lastOrderId = lastOrder.id.toString();

    const metafields = await getCustomerMetafields(customer.id);
    const lastPlayed = metafields.find(m => m.key === "last_played");

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

// 🟢 RUTA 2: Actualizar monedas
app.post("/actualizar-monedas", async (req, res) => {
  try {
    const { email, monedas } = req.body;
    if (!email || !monedas) return res.status(400).json({ error: "Datos incompletos" });

    const customer = await getCustomerByEmail(email);
    if (!customer) return res.json({ ok: false, motivo: "Cliente no encontrado" });

    const metafields = await getCustomerMetafields(customer.id);
    let monedasField = metafields.find(m => m.key === "coins");

    const nuevasMonedas = monedasField ? parseInt(monedasField.value) + monedas : monedas;

    if (monedasField) {
      await fetch(`${BASE_URL}/metafields/${monedasField.id}.json`, {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          metafield: { id: monedasField.id, value: nuevasMonedas.toString() }
        })
      });
    } else {
      await updateMetafield(customer.id, "custom", "coins", nuevasMonedas.toString());
    }

    res.json({ ok: true, total: nuevasMonedas });
  } catch (error) {
    console.error("❌ Error en /actualizar-monedas:", error);
    res.status(500).json({ error: "Error al actualizar monedas" });
  }
});

// 🟣 INICIO DEL SERVIDOR CON LOCAL TUNNEL
app.listen(PORT, async () => {
  console.log(`✅ Servidor iniciado en puerto ${PORT}`);

  // Crea túnel automáticamente
  const tunnel = await localtunnel({ port: PORT, subdomain: "rasca" }).catch(() => null);

  if (tunnel && tunnel.url) {
    console.log(`🌍 Servidor público: ${tunnel.url}`);
    console.log("🔗 Usa esta URL en tu código de Shopify para conectar el juego.");
  } else {
    console.log("⚠️ No se pudo crear el túnel. Revisa tu conexión o instala localtunnel.");
  }
});


