const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

require('dotenv').config();

// Konfigurasi koneksi database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Penting untuk Railway
});

// Tes koneksi saat start
pool.connect((err, client, release) => {
  if (err) {
    console.error('Koneksi database gagal:', err.stack);
    return;
  }
  console.log('Koneksi database berhasil!');
  release();
});

app.use(cors());
app.use(express.json());

// Endpoint produk
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    console.error('Error di /api/products:', err.stack);
    res.status(500).send('Error mengambil data produk');
  }
});

app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).send('Produk tidak ditemukan');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error di /api/products/:id:', err.stack);
    res.status(500).send('Error mengambil detail produk');
  }
});

// Endpoint cart - tambah item
app.post('/api/cart', async (req, res) => {
  const { user_id, product_id, quantity } = req.body;
  try {
    const existingItem = await pool.query('SELECT * FROM cart WHERE product_id = $1', [product_id]);

    if (existingItem.rows.length > 0) {
      // Jika produk sudah ada, perbarui kuantitas
      const updatedItem = await pool.query(
        'UPDATE cart SET quantity = quantity + $1 WHERE product_id = $2 RETURNING *',
        [quantity, product_id]
      );
      return res.status(200).json(updatedItem.rows[0]);
    } else {
      // Jika produk belum ada, masukkan item baru
      const result = await pool.query(
        'INSERT INTO cart (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *',
        [user_id, product_id, quantity]
      );
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    console.error('Error menambahkan ke cart:', err.stack);
    res.status(500).send('Error menambahkan data ke keranjang');
  }
});

// Endpoint cart - ambil semua item
app.get('/api/cart', async (req, res) => {
  try {
    const result = await pool.query('SELECT c.*, p.name, p.price, p.image FROM cart c JOIN products p ON c.product_id = p.id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error mengambil cart:', err.stack);
    res.status(500).send('Error mengambil data keranjang');
  }
});

// Endpoint cart - update quantity
app.put('/api/cart/:id', async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;
  try {
    const result = await pool.query(
      'UPDATE cart SET quantity = $1 WHERE id = $2 RETURNING *',
      [quantity, id]
    );
    if (result.rows.length === 0) return res.status(404).send('Item tidak ditemukan');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error memperbarui cart:', err.stack);
    res.status(500).send('Error memperbarui kuantitas');
  }
});

// Endpoint cart - hapus item
app.delete('/api/cart/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM cart WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).send('Item tidak ditemukan');
    res.status(204).send();
  } catch (err) {
    console.error('Error menghapus dari cart:', err.stack);
    res.status(500).send('Error menghapus item dari keranjang');
  }
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});