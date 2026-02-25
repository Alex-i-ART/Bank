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
app.use(cors());
app.use(express.static(path.join(__dirname)));

// Сессии
app.use(session({
    secret: 'tg-bank-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 // 24 часа
    }
}));

// Инициализация базы данных
const db = new sqlite3.Database('./bank.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err);
    } else {
        console.log('Подключено к SQLite базе данных');
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
            status TEXT DEFAULT 'pending',
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
            FOREIGN KEY (loan_id) REFERENCES loans (id)
        )`);

        console.log('Таблицы созданы или уже существуют');
        
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
            console.error('Ошибка проверки пользователя:', err);
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
                            console.error('Ошибка создания тестового пользователя:', err);
                        } else {
                            console.log('Тестовый пользователь создан: user/password');
                        }
                    }
                );
            } catch (error) {
                console.error('Ошибка хеширования пароля:', error);
            }
        } else {
            console.log('Тестовый пользователь уже существует');
        }
    });
}

// Маршруты API

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password, full_name, email, phone } = req.body;
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (username, password, full_name, email, phone) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, full_name, email, phone],
            function(err) {
                if (err) {
                    return res.status(400).json({ error: 'Пользователь уже существует' });
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
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
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
    req.session.destroy();
    res.json({ success: true });
});

// Создание кредита
app.post('/api/loans/create', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    const { amount, term } = req.body;
    const userId = req.session.userId;
    
    // Расчет аннуитетного платежа
    const interestRate = 12.5; // 12.5% годовых
    const monthlyRate = interestRate / 100 / 12;
    const monthlyPayment = amount * monthlyRate * Math.pow(1 + monthlyRate, term) / (Math.pow(1 + monthlyRate, term) - 1);
    const totalAmount = monthlyPayment * term;
    
    const nextPaymentDate = new Date();
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
    
    db.run(
        `INSERT INTO loans (user_id, amount, term_months, monthly_payment, total_amount, remaining_amount, next_payment_date) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, amount, term, monthlyPayment, totalAmount, totalAmount, nextPaymentDate.toISOString().split('T')[0]],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Ошибка создания кредита' });
            }
            
            const loanId = this.lastID;
            
            // Создание графика платежей
            let remainingBalance = totalAmount;
            for (let i = 1; i <= term; i++) {
                const interestPayment = remainingBalance * monthlyRate;
                const principalPayment = monthlyPayment - interestPayment;
                remainingBalance -= principalPayment;
                
                const dueDate = new Date();
                dueDate.setMonth(dueDate.getMonth() + i);
                
                db.run(
                    `INSERT INTO payment_schedule (loan_id, payment_number, due_date, amount, principal, interest, remaining_balance)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [loanId, i, dueDate.toISOString().split('T')[0], monthlyPayment, principalPayment, interestPayment, Math.max(0, remainingBalance)]
                );
            }
            
            res.json({ 
                success: true, 
                message: 'Кредит успешно оформлен',
                loanId
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
        
        // Получаем активные кредиты
        db.all(`SELECT * FROM loans WHERE user_id = ? AND status = 'active'`, [userId], (err, loans) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка получения данных' });
            }
            
            // Для каждого кредита получаем график платежей
            const loansWithSchedule = [];
            let completed = 0;
            
            if (loans.length === 0) {
                return res.json({ user, loans: [] });
            }
            
            loans.forEach((loan, index) => {
                db.all(
                    `SELECT * FROM payment_schedule WHERE loan_id = ? ORDER BY payment_number`,
                    [loan.id],
                    (err, schedule) => {
                        if (err) {
                            console.error('Ошибка получения графика:', err);
                        }
                        
                        // Рассчитываем пени
                        const today = new Date();
                        schedule.forEach(payment => {
                            if (payment.status === 'pending') {
                                const dueDate = new Date(payment.due_date);
                                if (today > dueDate) {
                                    const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                                    payment.penalty = payment.amount * 0.001 * daysOverdue; // 0.1% в день
                                } else {
                                    payment.penalty = 0;
                                }
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
    
    db.get('SELECT * FROM loans WHERE id = ? AND user_id = ?', [loanId, userId], (err, loan) => {
        if (err || !loan) {
            return res.status(404).json({ error: 'Кредит не найден' });
        }
        
        // Получаем следующий платеж
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
                
                if (today > dueDate) {
                    const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                    penalty = nextPayment.amount * 0.001 * daysOverdue;
                }
                
                const totalDue = nextPayment.amount + penalty;
                let message = '';
                
                if (amount >= totalDue) {
                    // Полная оплата
                    const change = amount - totalDue;
                    message = `Платеж принят. Сдача: ${change.toFixed(2)} ₽`;
                    
                    db.run(
                        `UPDATE payment_schedule SET status = 'paid' WHERE id = ?`,
                        [nextPayment.id]
                    );
                    
                    db.run(
                        `UPDATE loans SET remaining_amount = remaining_amount - ? WHERE id = ?`,
                        [nextPayment.amount, loanId]
                    );
                    
                } else if (amount >= nextPayment.amount) {
                    // Оплачена основная сумма, но не пеня
                    message = `Внесено ${amount} ₽. Требуется доплатить пени: ${(totalDue - amount).toFixed(2)} ₽`;
                    
                } else {
                    // Частичная оплата
                    const remaining = nextPayment.amount - amount;
                    message = `Внесено ${amount} ₽. Осталось оплатить: ${(remaining + penalty).toFixed(2)} ₽ (включая пени)`;
                }
                
                // Записываем платеж
                db.run(
                    `INSERT INTO payments (loan_id, user_id, amount, due_date, penalty, status)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [loanId, userId, amount, nextPayment.due_date, penalty, 'completed'],
                    (err) => {
                        if (err) {
                            return res.status(500).json({ error: 'Ошибка записи платежа' });
                        }
                        
                        res.json({
                            success: true,
                            message,
                            payment: {
                                amount,
                                penalty,
                                nextPaymentDue: totalDue - amount
                            }
                        });
                    }
                );
            }
        );
    });
});

// Обслуживание HTML страниц
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});

// Корневой маршрут для проверки API
app.get('/api/test', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'API работает',
        time: new Date().toISOString()
    });
});

// Обработка всех несуществующих маршрутов API
app.use('/api/*', (req, res) => {
    console.log('❌ Не найден API маршрут:', req.originalUrl);
    res.status(404).json({ 
        error: 'API маршрут не найден',
        path: req.originalUrl,
        method: req.method
    });
});

// Обслуживание статических файлов
app.use(express.static(path.join(__dirname)));

// Все остальные маршруты должны вести на index.html (для SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});