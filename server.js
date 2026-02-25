const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({
    origin: 'https://tg-bank.onrender.com', // Точный адрес вашего сайта
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use((req, res, next) => {
    console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});
app.use(express.static(path.join(__dirname)));

// Настройка сессий
app.use(session({
    secret: process.env.SESSION_SECRET || 'tg-bank-secret-key-2024',
    resave: true, // Важно!
    saveUninitialized: true, // Важно!
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24, // 24 часа
        sameSite: 'lax',
        domain: process.env.NODE_ENV === 'production' ? '.onrender.com' : undefined
    }
}));

// Инициализация базы данных
const db = new sqlite3.Database('./bank.db', (err) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err);
    } else {
        console.log('✅ Подключено к SQLite базе данных');
        initDatabase();
    }
});

// Создание таблиц
function initDatabase() {
    db.serialize(() => {
        // Таблица пользователей
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Таблица кредитов
        db.run(`CREATE TABLE IF NOT EXISTS loans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            term_months INTEGER NOT NULL,
            interest_rate REAL DEFAULT 12.5,
            monthly_payment REAL NOT NULL,
            total_amount REAL NOT NULL,
            remaining_amount REAL NOT NULL,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            next_payment_date DATE,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Таблица платежей
        db.run(`CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loan_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            due_date DATE NOT NULL,
            penalty REAL DEFAULT 0,
            status TEXT DEFAULT 'completed',
            FOREIGN KEY (loan_id) REFERENCES loans (id),
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Таблица графика платежей
        db.run(`CREATE TABLE IF NOT EXISTS payment_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loan_id INTEGER NOT NULL,
            payment_number INTEGER NOT NULL,
            due_date DATE NOT NULL,
            amount REAL NOT NULL,
            principal REAL NOT NULL,
            interest REAL NOT NULL,
            remaining_balance REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            penalty REAL DEFAULT 0,
            penalty_days INTEGER DEFAULT 0,
            FOREIGN KEY (loan_id) REFERENCES loans (id)
        )`);

        console.log('✅ Таблицы созданы или уже существуют');
        
        // Создаем тестового пользователя
        createTestUser();
    });
}

// Создание тестового пользователя
async function createTestUser() {
    const testUser = {
        username: 'user',
        password: 'password',
        full_name: 'Иван Петров',
        email: 'ivan@email.com',
        phone: '+7 (999) 123-45-67'
    };

    db.get('SELECT id FROM users WHERE username = ?', [testUser.username], async (err, row) => {
        if (err) {
            console.error('❌ Ошибка проверки пользователя:', err);
            return;
        }

        if (!row) {
            try {
                const hashedPassword = await bcrypt.hash(testUser.password, 10);
                db.run(
                    'INSERT INTO users (username, password, full_name, email, phone) VALUES (?, ?, ?, ?, ?)',
                    [testUser.username, hashedPassword, testUser.full_name, testUser.email, testUser.phone],
                    function(err) {
                        if (err) {
                            console.error('❌ Ошибка создания тестового пользователя:', err);
                        } else {
                            console.log('✅ Тестовый пользователь создан: user/password');
                        }
                    }
                );
            } catch (error) {
                console.error('❌ Ошибка хеширования пароля:', error);
            }
        } else {
            console.log('✅ Тестовый пользователь уже существует');
        }
    });
}

// ==================== API МАРШРУТЫ ====================

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password, full_name, email, phone } = req.body;
    
    // Валидация
    if (!username || !password || !full_name || !email) {
        return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (username, password, full_name, email, phone) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, full_name, email, phone],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Пользователь с таким логином или email уже существует' });
                    }
                    return res.status(500).json({ error: 'Ошибка базы данных' });
                }
                
                req.session.userId = this.lastID;
                req.session.username = username;
                
                res.json({ 
                    success: true, 
                    message: 'Регистрация успешна',
                    user: { id: this.lastID, username, full_name, email, phone }
                });
            }
        );
    } catch (error) {
        console.error('❌ Ошибка регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Введите логин и пароль' });
    }
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        
        if (!user) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        
        try {
            const validPassword = await bcrypt.compare(password, user.password);
            
            if (!validPassword) {
                return res.status(401).json({ error: 'Неверный логин или пароль' });
            }
            
            req.session.userId = user.id;
            req.session.username = user.username;
            
            res.json({ 
                success: true, 
                message: 'Вход выполнен успешно',
                user: {
                    id: user.id,
                    username: user.username,
                    full_name: user.full_name,
                    email: user.email,
                    phone: user.phone
                }
            });
        } catch (error) {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });
});

// Проверка авторизации
app.get('/api/check-auth', (req, res) => {
    if (req.session.userId) {
        db.get('SELECT id, username, full_name, email, phone FROM users WHERE id = ?', 
            [req.session.userId], 
            (err, user) => {
                if (err || !user) {
                    return res.json({ authenticated: false });
                }
                res.json({ authenticated: true, user });
            }
        );
    } else {
        res.json({ authenticated: false });
    }
});

// Выход
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка при выходе' });
        }
        res.json({ success: true });
    });
});

// Создание кредита
app.post('/api/loans/create', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    const { amount, term } = req.body;
    const userId = req.session.userId;
    
    // Валидация
    if (!amount || !term || amount < 10000 || amount > 5000000 || term < 6 || term > 60) {
        return res.status(400).json({ error: 'Неверные параметры кредита' });
    }
    
    // Расчет аннуитетного платежа
    const interestRate = 12.5; // 12.5% годовых
    const monthlyRate = interestRate / 100 / 12;
    
    // Правильная формула аннуитета
    const annuityFactor = (monthlyRate * Math.pow(1 + monthlyRate, term)) / (Math.pow(1 + monthlyRate, term) - 1);
    const monthlyPayment = amount * annuityFactor;
    const totalAmount = monthlyPayment * term;
    
    const nextPaymentDate = new Date();
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
    nextPaymentDate.setDate(28); // Фиксируем день платежа
    
    db.run(
        `INSERT INTO loans (user_id, amount, term_months, monthly_payment, total_amount, remaining_amount, next_payment_date) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, amount, term, monthlyPayment, totalAmount, totalAmount, nextPaymentDate.toISOString().split('T')[0]],
        function(err) {
            if (err) {
                console.error('❌ Ошибка создания кредита:', err);
                return res.status(500).json({ error: 'Ошибка создания кредита' });
            }
            
            const loanId = this.lastID;
            
            // Создание графика платежей
            let remainingBalance = totalAmount;
            const queries = [];
            
            for (let i = 1; i <= term; i++) {
                const interestPayment = remainingBalance * monthlyRate;
                const principalPayment = monthlyPayment - interestPayment;
                remainingBalance -= principalPayment;
                
                const dueDate = new Date();
                dueDate.setMonth(dueDate.getMonth() + i);
                dueDate.setDate(28); // Фиксируем день платежа
                
                queries.push(new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO payment_schedule 
                         (loan_id, payment_number, due_date, amount, principal, interest, remaining_balance, status) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [loanId, i, dueDate.toISOString().split('T')[0], 
                         monthlyPayment, principalPayment, interestPayment, 
                         Math.max(0, remainingBalance), 'pending'],
                        function(err) {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                }));
            }
            
            Promise.all(queries)
                .then(() => {
                    console.log(`✅ Кредит ${loanId} успешно создан для пользователя ${userId}`);
                    res.json({ 
                        success: true, 
                        message: 'Кредит успешно оформлен',
                        loanId
                    });
                })
                .catch(err => {
                    console.error('❌ Ошибка создания графика:', err);
                    res.status(500).json({ error: 'Ошибка создания графика платежей' });
                });
        }
    );
});

// Получение данных пользователя и кредитов
app.get('/api/user-data', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    const userId = req.session.userId;
    
    db.get('SELECT full_name, email, phone FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Получаем все кредиты пользователя
        db.all(`SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, loans) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка получения данных' });
            }
            
            if (loans.length === 0) {
                return res.json({ user, loans: [] });
            }
            
            const loansWithSchedule = [];
            let completed = 0;
            
            loans.forEach((loan, index) => {
                db.all(
                    `SELECT * FROM payment_schedule WHERE loan_id = ? ORDER BY payment_number`,
                    [loan.id],
                    (err, schedule) => {
                        if (err) {
                            console.error('❌ Ошибка получения графика:', err);
                            schedule = [];
                        }
                        
                        // Рассчитываем пени и обновляем статусы
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        
                        schedule.forEach(payment => {
                            const dueDate = new Date(payment.due_date);
                            dueDate.setHours(0, 0, 0, 0);
                            
                            if (payment.status === 'pending') {
                                if (today > dueDate) {
                                    const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                                    payment.penalty = payment.amount * 0.001 * daysOverdue;
                                    payment.penalty_days = daysOverdue;
                                } else {
                                    payment.penalty = 0;
                                    payment.penalty_days = 0;
                                }
                            } else {
                                payment.penalty = 0;
                                payment.penalty_days = 0;
                            }
                        });
                        
                        loan.schedule = schedule;
                        loansWithSchedule[index] = loan;
                        completed++;
                        
                        if (completed === loans.length) {
                            res.json({ 
                                user, 
                                loans: loansWithSchedule.filter(l => l !== undefined)
                            });
                        }
                    }
                );
            });
        });
    });
});

// Внесение платежа
app.post('/api/payments/make', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    const { loanId, amount } = req.body;
    const userId = req.session.userId;
    
    if (!loanId || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Неверные параметры платежа' });
    }
    
    db.get('SELECT * FROM loans WHERE id = ? AND user_id = ?', [loanId, userId], (err, loan) => {
        if (err || !loan) {
            return res.status(404).json({ error: 'Кредит не найден' });
        }
        
        // Получаем следующий непогашенный платеж
        db.get(
            `SELECT * FROM payment_schedule 
             WHERE loan_id = ? AND status = 'pending' 
             ORDER BY payment_number ASC LIMIT 1`,
            [loanId],
            (err, nextPayment) => {
                if (err || !nextPayment) {
                    return res.status(400).json({ error: 'Нет активных платежей' });
                }
                
                const today = new Date();
                const dueDate = new Date(nextPayment.due_date);
                let penalty = 0;
                
                // Расчет пени за просрочку
                if (today > dueDate) {
                    const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                    penalty = nextPayment.amount * 0.001 * daysOverdue;
                }
                
                const totalDue = nextPayment.amount + penalty;
                let message = '';
                let updateQuery = null;
                
                if (amount >= totalDue) {
                    // Полная оплата с учетом пени
                    const change = (amount - totalDue).toFixed(2);
                    message = `✅ Платеж принят. Сдача: ${change} ₽`;
                    
                    // Обновляем статус платежа
                    updateQuery = new Promise((resolve, reject) => {
                        db.run(
                            `UPDATE payment_schedule SET status = 'paid' WHERE id = ?`,
                            [nextPayment.id],
                            function(err) {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                    
                    // Обновляем остаток по кредиту
                    updateQuery = Promise.all([
                        updateQuery,
                        new Promise((resolve, reject) => {
                            db.run(
                                `UPDATE loans SET remaining_amount = remaining_amount - ? WHERE id = ?`,
                                [nextPayment.amount, loanId],
                                function(err) {
                                    if (err) reject(err);
                                    else resolve();
                                }
                            );
                        })
                    ]);
                    
                } else if (amount >= nextPayment.amount) {
                    // Оплачена основная сумма, но не пеня
                    const remainingPenalty = (totalDue - amount).toFixed(2);
                    message = `⚠️ Внесено ${amount} ₽. Требуется доплатить пени: ${remainingPenalty} ₽`;
                    
                    // Частично оплачиваем платеж
                    updateQuery = new Promise((resolve, reject) => {
                        db.run(
                            `UPDATE payment_schedule SET amount = amount - ? WHERE id = ?`,
                            [amount, nextPayment.id],
                            function(err) {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                    
                } else {
                    // Частичная оплата основной суммы
                    const remaining = (nextPayment.amount - amount).toFixed(2);
                    message = `⚠️ Внесено ${amount} ₽. Осталось оплатить: ${(remaining + penalty).toFixed(2)} ₽ (включая пени)`;
                    
                    // Уменьшаем сумму платежа
                    updateQuery = new Promise((resolve, reject) => {
                        db.run(
                            `UPDATE payment_schedule SET amount = amount - ? WHERE id = ?`,
                            [amount, nextPayment.id],
                            function(err) {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                }
                
                // Записываем платеж в историю
                const paymentPromise = new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO payments (loan_id, user_id, amount, due_date, penalty, status)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [loanId, userId, amount, nextPayment.due_date, penalty, 'completed'],
                        function(err) {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
                
                if (updateQuery) {
                    Promise.all([paymentPromise, updateQuery])
                        .then(() => {
                            res.json({
                                success: true,
                                message,
                                payment: {
                                    amount,
                                    penalty,
                                    nextPaymentDue: (totalDue - amount).toFixed(2)
                                }
                            });
                        })
                        .catch(err => {
                            console.error('❌ Ошибка записи платежа:', err);
                            res.status(500).json({ error: 'Ошибка записи платежа' });
                        });
                } else {
                    paymentPromise
                        .then(() => {
                            res.json({
                                success: true,
                                message,
                                payment: {
                                    amount,
                                    penalty,
                                    nextPaymentDue: (totalDue - amount).toFixed(2)
                                }
                            });
                        })
                        .catch(err => {
                            console.error('❌ Ошибка записи платежа:', err);
                            res.status(500).json({ error: 'Ошибка записи платежа' });
                        });
                }
            }
        );
    });
});

// Тестовый маршрут API
app.get('/api/test', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'API работает',
        time: new Date().toISOString(),
        session: req.session.userId ? 'active' : 'none'
    });
});

// ==================== СТАТИЧЕСКИЕ ФАЙЛЫ И МАРШРУТЫ ====================

// Обслуживание статических файлов (уже есть app.use выше)

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Страница входа
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Личный кабинет (с проверкой авторизации)
app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Обработка всех несуществующих API маршрутов
app.use('/api/*', (req, res) => {
    console.log('❌ Не найден API маршрут:', req.originalUrl);
    res.status(404).json({ 
        error: 'API маршрут не найден',
        path: req.originalUrl,
        method: req.method
    });
});

// Все остальные маршруты перенаправляем на главную
app.get('*', (req, res) => {
    res.redirect('/');
});

// ==================== ЗАПУСК СЕРВЕРА ====================
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Локальный доступ: http://localhost:${PORT}`);
    console.log(`📊 Режим: ${process.env.NODE_ENV || 'development'}`);
});