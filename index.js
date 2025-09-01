// index.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library'); // <--- Tambahan: Impor Google Auth Library

const app = express();

// Konfigurasi environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';
const SALT_ROUNDS = 10;
// <--- Tambahan: ID Klien Google Anda
// Penting: Ganti placeholder di bawah dengan Client ID Anda dari Google Cloud Console
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'MASUKKAN_CLIENT_ID_GOOGLE_ANDA_DI_SINI'; 
const client = new OAuth2Client(GOOGLE_CLIENT_ID); // <--- Tambahan: Inisialisasi Google OAuth Client

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
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token tidak valid' });
    }
    req.user = user;
    next();
  });
};

// --- Rute Autentikasi yang Dimodifikasi ---

// Rute Registrasi Pengguna (Dimodifikasi)
// Sekarang rute ini akan mengembalikan token agar pengguna langsung login setelah mendaftar
app.post('/api/auth/register', async (req, res) => {
  const { full_name, email, password, address, city, postal_code } = req.body;

  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Nama, email, dan password harus diisi.' });
  }

  try {
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email sudah terdaftar.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      'INSERT INTO users (full_name, email, password, address, city, postal_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, full_name, email',
      [full_name, email, hashedPassword, address, city, postal_code]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });

    // Mengirim token dan data pengguna
    res.status(201).json({ message: 'Registrasi berhasil!', token, user });
  } catch (err) {
    console.error('Error saat registrasi:', err.message);
    res.status(500).json({ error: 'Gagal melakukan registrasi.' });
  }
});

// Rute Login Pengguna (Tidak Berubah)
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }

    const user = userResult.rows[0];

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });

    res.json({
      message: 'Login berhasil!',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('Error saat login:', err.message);
    res.status(500).json({ error: 'Gagal melakukan login.' });
  }
});

// <--- Tambahan: Rute baru untuk Autentikasi Google
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token Google diperlukan.' });
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Cari pengguna di database berdasarkan email
    let userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    let user;
    let message;

    if (userResult.rows.length === 0) {
      // Jika pengguna belum ada, daftarkan pengguna baru
      const newUserResult = await pool.query(
        'INSERT INTO users (full_name, email, profile_picture) VALUES ($1, $2, $3) RETURNING id, full_name, email',
        [name, email, picture]
      );
      user = newUserResult.rows[0];
      message = 'Registrasi dengan Google berhasil!';
    } else {
      // Jika pengguna sudah ada, update info dan login
      user = userResult.rows[0];
      // Update nama atau foto profil jika diperlukan
      await pool.query(
        'UPDATE users SET full_name = $1, profile_picture = $2 WHERE email = $3',
        [name, picture, email]
      );
      message = 'Login dengan Google berhasil!';
    }

    // Buat token JWT untuk sesi
    const authToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });

    res.json({ message, token: authToken, user });

  } catch (err) {
    console.error('Error saat autentikasi Google:', err.message);
    res.status(500).json({ error: 'Gagal melakukan autentikasi dengan Google.' });
  }
});

// --- Rute Cart dan Produk yang Sudah Ada (Tidak Berubah) ---

app.post('/api/cart', authenticateToken, async (req, res) => {
  const user_id = req.user ? req.user.id : null;
  const { product_id, quantity } = req.body;

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

app.get('/api/cart', authenticateToken, async (req, res) => {
  const user_id = req.user ? req.user.id : null;
  try {
    const result = await pool.query(
      'SELECT c.*, p.name, p.price, p.image FROM cart c JOIN products p ON c.product_id = p.id WHERE c.user_id IS NOT DISTINCT FROM $1 ORDER BY c.id',
      [user_id]
    );
    console.log(`Mengambil ${result.rows.length} item cart`);
    res.json(result.rows);
  } catch (err) {
    console.error('Error mengambil cart:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data keranjang' });
  }
});

app.put('/api/cart/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;
  const user_id = req.user ? req.user.id : null;

  if (!quantity) {
    return res.status(400).json({ error: 'quantity diperlukan' });
  }

  try {
    const result = await pool.query(
      'UPDATE cart SET quantity = $1 WHERE id = $2 AND user_id IS NOT DISTINCT FROM $3 RETURNING *',
      [quantity, id, user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item tidak ditemukan atau Anda tidak memiliki akses untuk mengubahnya' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error memperbarui cart:', err.message);
    res.status(500).json({ error: 'Gagal memperbarui kuantitas' });
  }
});

app.delete('/api/cart/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const user_id = req.user ? req.user.id : null;

  try {
    const result = await pool.query('DELETE FROM cart WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2 RETURNING *', [id, user_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item tidak ditemukan atau Anda tidak memiliki akses untuk menghapusnya' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Error menghapus dari cart:', err.message);
    res.status(500).json({ error: 'Gagal menghapus item dari keranjang' });
  }
});

app.get('/', (req, res) => {
  res.json({ message: '✅ Backend is running!' });
});

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

app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error di /api/products/:id:', err.message);
    res.status(500).json({ error: 'Gagal mengambil detail produk' });
  }
});

module.exports = app;