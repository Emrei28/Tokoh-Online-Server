const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'https://tokohonline.netlify.app', credentials: true }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Koneksi database berhasil!');
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tabel di database:', tables.rows.map(row => row.table_name));
    client.release();
  } catch (err) {
    console.error('❌ Gagal terhubung ke database:', err.message);
  }
})();

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'Server berjalan',
    database_url: process.env.DATABASE_URL || 'Tidak diatur',
    frontend_url: process.env.FRONTEND_URL || 'Tidak diatur',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error di /api/products:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data produk' });
  }
});

app.post('/api/cart', async (req, res) => {
  const { user_id, product_id, quantity } = req.body;
  if (!product_id || !quantity) {
    return res.status(400).json({ error: 'product_id dan quantity diperlukan' });
  }
  try {
    const existingItem = await pool.query(
      'SELECT * FROM cart WHERE product_id = $1 AND user_id IS NOT DISTINCT FROM $2',
      [product_id, user_id]
    );
    if (existingItem.rows.length > 0) {
      const updatedItem = await pool.query(
        'UPDATE cart SET quantity = quantity + $1 WHERE product_id = $2 AND user_id IS NOT DISTINCT FROM $3 RETURNING *',
        [quantity, product_id, user_id]
      );
      return res.status(200).json(updatedItem.rows[0]);
    } else {
      const result = await pool.query(
        'INSERT INTO cart (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *',
        [user_id, product_id, quantity]
      );
      return res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    console.error('Error menambahkan ke cart:', err.message);
    res.status(500).json({ error: 'Gagal menambahkan ke keranjang' });
  }
});

app.get('/api/cart', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT c.*, p.name, p.price, p.image FROM cart c JOIN products p ON c.product_id = p.id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error mengambil cart:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data keranjang' });
  }
});

module.exports = app; // Tambahkan ini untuk Vercel