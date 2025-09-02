// index.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = express();

// Konfigurasi environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';
const SALT_ROUNDS = 10;

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

// Middleware untuk memverifikasi JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    console.log('Tidak ada token, menolak akses');
    return res.status(401).json({ error: 'Akses ditolak. Tidak ada token yang diberikan.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Token tidak valid:', err.message);
      return res.status(403).json({ error: 'Token tidak valid.' });
    }
    req.user = user;
    next();
  });
};

// Rute untuk registrasi pengguna baru
app.post('/api/register', async (req, res) => {
  const { full_name, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, email',
      [full_name, email, hashedPassword]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '2h' });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email sudah terdaftar.' });
    }
    console.error('Error saat registrasi:', err.message);
    res.status(500).json({ error: 'Gagal melakukan registrasi.' });
  }
});

// Rute untuk login pengguna
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email atau kata sandi salah.' });
    }
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Email atau kata sandi salah.' });
    }
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '2h' });
    res.status(200).json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('Error saat login:', err.message);
    res.status(500).json({ error: 'Gagal melakukan login.' });
  }
});

// Rute untuk mendapatkan semua produk
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    console.log(`Mengambil ${result.rows.length} produk`);
    res.json(result.rows);
  } catch (err) {
    console.error('Error di /api/products:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data produk' });
  }
});

// Rute untuk mendapatkan detail produk berdasarkan ID
app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error saat mengambil detail produk:', err.message);
    res.status(500).json({ error: 'Gagal mengambil detail produk.' });
  }
});

// Rute untuk mendapatkan item di keranjang pengguna
app.get('/api/cart', authenticateToken, async (req, res) => {
  const user_id = req.user.id;
  try {
    const result = await pool.query(
      'SELECT c.id, p.id AS product_id, p.name, p.price, p.image, c.quantity FROM cart c JOIN products p ON c.product_id = p.id WHERE c.user_id = $1 ORDER BY c.created_at ASC',
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error saat mengambil cart:', err.message);
    res.status(500).json({ error: 'Gagal mengambil isi keranjang' });
  }
});

// Rute untuk menambahkan produk ke keranjang (Perbaikan di sini!)
app.post('/api/cart', authenticateToken, async (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  const user_id = req.user.id;

  if (!product_id) {
    return res.status(400).json({ error: 'product_id diperlukan.' });
  }

  try {
    const existingItem = await pool.query(
      'SELECT * FROM cart WHERE user_id = $1 AND product_id = $2',
      [user_id, product_id]
    );

    if (existingItem.rows.length > 0) {
      const newQuantity = existingItem.rows[0].quantity + quantity;
      const updatedItem = await pool.query(
        'UPDATE cart SET quantity = $1, updated_at = NOW() WHERE user_id = $2 AND product_id = $3 RETURNING *',
        [newQuantity, user_id, product_id]
      );
      res.status(200).json(updatedItem.rows[0]);
    } else {
      const newItem = await pool.query(
        'INSERT INTO cart (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *',
        [user_id, product_id, quantity]
      );
      res.status(201).json(newItem.rows[0]);
    }
  } catch (err) {
    console.error('Error saat menambahkan ke cart:', err.message);
    res.status(500).json({ error: 'Gagal menambahkan produk ke keranjang.' });
  }
});

// Rute untuk memperbarui kuantitas produk di keranjang
app.put('/api/cart/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;
  const user_id = req.user.id;
  try {
    if (quantity <= 0) {
      return res.status(400).json({ error: 'Kuantitas harus lebih besar dari 0.' });
    }
    const result = await pool.query(
      'UPDATE cart SET quantity = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
      [quantity, id, user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item tidak ditemukan atau Anda tidak memiliki akses untuk memperbarui.' });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error memperbarui kuantitas:', err.message);
    res.status(500).json({ error: 'Gagal memperbarui kuantitas.' });
  }
});

// Rute untuk menghapus produk dari keranjang
app.delete('/api/cart/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;
  try {
    const result = await pool.query('DELETE FROM cart WHERE id = $1 AND user_id = $2 RETURNING *', [id, user_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item tidak ditemukan atau Anda tidak memiliki akses untuk menghapusnya' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Error menghapus dari cart:', err.message);
    res.status(500).json({ error: 'Gagal menghapus item dari keranjang' });
  }
});

// Rute lainnya
app.get('/', (req, res) => {
  res.json({ message: '✅ Backend is running!' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server berjalan di port ${PORT}`);
});