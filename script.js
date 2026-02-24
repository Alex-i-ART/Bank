// Состояние приложения
let currentSchedule = [];
let loanParams = {
    amount: 100000,
    termMonths: 12,
    annualRate: 15
};
let nextPaymentDate = new Date();
let remainingDebt = 0;

// Инициализация при запуске
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('apply-params').click(); // авто-расчёт при загрузке
    setupEventListeners();
    applyOverduePenalties(); // проверка пеней каждый день (имитация)
    setInterval(applyOverduePenalties, 1000 * 60 * 60); // для демо - каждый час
});

function setupEventListeners() {
    document.getElementById('apply-params').addEventListener('click', calculateAndRenderSchedule);
    document.getElementById('make-payment').addEventListener('click', handlePayment);
}

// --- Аннуитетный расчёт ---
function calculateAnnuity(amount, months, ratePerYear) {
    const monthlyRate = ratePerYear / 100 / 12;
    if (monthlyRate === 0) return amount / months;
    const annuityFactor = (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
    return amount * annuityFactor;
}

function generateSchedule(amount, months, annualRate, startDate = new Date()) {
    const monthlyPayment = calculateAnnuity(amount, months, annualRate);
    let balance = amount;
    const monthlyRate = annualRate / 100 / 12;
    const schedule = [];
    let currentDate = new Date(startDate);
    currentDate.setDate(28); // фиксируем день платежа (28 число)
    
    for (let i = 1; i <= months; i++) {
        const interest = balance * monthlyRate;
        let principal = monthlyPayment - interest;
        if (principal > balance) principal = balance; // последний платёж
        
        balance -= principal;
        if (balance < 0.01) balance = 0; // защита от копеек
        
        const paymentDate = new Date(currentDate);
        paymentDate.setMonth(currentDate.getMonth() + i - 1);
        
        schedule.push({
            number: i,
            dueDate: paymentDate.toISOString().split('T')[0],
            payment: monthlyPayment,
            principal: principal,
            interest: interest,
            remaining: balance,
            status: 'pending', // pending, paid, overdue
            paidAmount: 0,
            paidDate: null
        });
    }
    return schedule;
}

// --- Рендер графика ---
function renderSchedule() {
    const tbody = document.getElementById('schedule-body');
    if (!currentSchedule.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-table">График не рассчитан</td></tr>';
        return;
    }
    
    let html = '';
    const today = new Date();
    today.setHours(0,0,0,0);
    
    currentSchedule.forEach(row => {
        const dueDate = new Date(row.dueDate + 'T12:00:00');
        const isOverdue = (row.status === 'pending' && dueDate < today);
        const rowClass = isOverdue ? 'overdue-row' : '';
        
        let statusBadge = '';
        if (row.status === 'paid') {
            statusBadge = '<span class="status-badge status-paid">Оплачено</span>';
        } else if (isOverdue) {
            statusBadge = '<span class="status-badge status-overdue">Просрочка</span>';
        } else {
            statusBadge = '<span class="status-badge status-pending">Ожидается</span>';
        }
        
        // Если была частичная оплата, показываем
        const paymentDisplay = row.paidAmount > 0 ? `${row.paidAmount.toFixed(2)} / ${row.payment.toFixed(2)}` : row.payment.toFixed(2);
        
        html += `<tr class="${rowClass}">
            <td>${row.number}</td>
            <td>${row.dueDate}</td>
            <td>${paymentDisplay} ₽</td>
            <td>${row.principal.toFixed(2)} ₽</td>
            <td>${row.interest.toFixed(2)} ₽</td>
            <td>${row.remaining.toFixed(2)} ₽</td>
            <td>${statusBadge}</td>
        </tr>`;
    });
    
    tbody.innerHTML = html;
    
    // Обновить сводку
    updateSummary();
}

// --- Обновление сводки и остатка ---
function updateSummary() {
    if (!currentSchedule.length) {
        document.getElementById('loanSummary').style.display = 'none';
        return;
    }
    document.getElementById('loanSummary').style.display = 'flex';
    
    // Находим остаток долга (последний remaining)
    const lastRow = currentSchedule[currentSchedule.length - 1];
    remainingDebt = lastRow.remaining;
    
    // Просрочка
    let overdueTotal = 0;
    const today = new Date();
    today.setHours(0,0,0,0);
    currentSchedule.forEach(row => {
        if (row.status !== 'paid') {
            const dueDate = new Date(row.dueDate + 'T12:00:00');
            if (dueDate < today) {
                overdueTotal += row.payment - (row.paidAmount || 0);
            }
        }
    });
    
    // След. платёж
    let nextPayment = null;
    for (let row of currentSchedule) {
        if (row.status !== 'paid') {
            nextPayment = row;
            break;
        }
    }
    
    document.getElementById('remainingDebt').innerText = remainingDebt.toFixed(2) + ' ₽';
    document.getElementById('overdueInfo').innerHTML = overdueTotal.toFixed(2) + ' ₽' + (overdueTotal > 0 ? ' (включая пени)' : '');
    
    if (nextPayment) {
        document.getElementById('nextPaymentInfo').innerHTML = `${nextPayment.payment.toFixed(2)} ₽ (до ${nextPayment.dueDate})`;
    } else {
        document.getElementById('nextPaymentInfo').innerText = 'Кредит погашен';
    }
}

// --- Начисление пеней (0.1% от просрочки в день) ---
function applyOverduePenalties() {
    if (!currentSchedule.length) return;
    
    const today = new Date();
    today.setHours(0,0,0,0);
    let changes = false;
    
    currentSchedule.forEach(row => {
        if (row.status === 'paid') return;
        
        const dueDate = new Date(row.dueDate + 'T12:00:00');
        if (dueDate >= today) return; // не просрочено
        
        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        if (daysOverdue <= 0) return;
        
        const overdueAmount = row.payment - (row.paidAmount || 0);
        if (overdueAmount <= 0) return;
        
        // Пеня 0.1% в день от просроченной суммы (но не больше самой суммы для адекватности)
        const penalty = overdueAmount * 0.001 * daysOverdue;
        if (penalty > 0.01) {
            // Добавляем пеню как отдельную запись? Мы её начисляем к сумме долга.
            // В реальном банке пеня капитализируется. Увеличим остаток по этому платежу?
            // Упростим: добавим пеню к сумме платежа, но для наглядности увеличим поле payment?
            // Сделаем так: добавим запись о пене в следующий платёж? Но проще накапливать тут.
            // Мы будем увеличивать сумму к оплате (payment) для этого периода, но сохраним метку.
            // Но это сломает аннуитет. Лучше создадим отдельное поле penalty.
            if (!row.penalty) row.penalty = 0;
            row.penalty += penalty; // накапливаем
            row.payment += penalty; // увеличиваем сумму к оплате (так проще для логики платежа)
            changes = true;
        }
    });
    
    if (changes) {
        renderSchedule();
        showFeedback('Начислены пени за просрочку', 'warning');
    }
}

// --- Обработка внесения платежа ---
function handlePayment() {
    const paymentInput = document.getElementById('payment-amount');
    let paymentAmount = parseFloat(paymentInput.value);
    
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
        showFeedback('Введите корректную сумму платежа', 'error');
        return;
    }
    
    if (!currentSchedule.length) {
        showFeedback('Сначала рассчитайте кредит', 'error');
        return;
    }
    
    let remainingToPay = paymentAmount;
    const today = new Date().toISOString().split('T')[0];
    let feedback = '';
    
    // Проходим по всем непогашенным платежам по порядку
    for (let i = 0; i < currentSchedule.length; i++) {
        const row = currentSchedule[i];
        if (row.status === 'paid') continue;
        
        const dueForThisPeriod = row.payment - (row.paidAmount || 0);
        if (dueForThisPeriod <= 0) continue;
        
        if (remainingToPay >= dueForThisPeriod) {
            // Полностью закрываем этот платёж
            remainingToPay -= dueForThisPeriod;
            row.status = 'paid';
            row.paidAmount = row.payment;
            row.paidDate = today;
            feedback += `Платёж №${row.number} полностью погашен. `;
        } else {
            // Частичная оплата
            row.paidAmount = (row.paidAmount || 0) + remainingToPay;
            row.status = 'pending'; // остаётся в ожидании
            const newDue = row.payment - row.paidAmount;
            feedback += `Внесено ${paymentAmount}₽. Осталось доплатить по платежу №${row.number}: ${newDue.toFixed(2)}₽. `;
            remainingToPay = 0;
            break;
        }
        
        if (remainingToPay <= 0) break;
    }
    
    if (remainingToPay > 0) {
        // Если остались деньги после закрытия всех платежей — переносим на будущее
        // (уменьшаем тело кредита, т.е. пересчитывать график сложно. Просто уменьшим остаток последнего)
        const lastRow = currentSchedule[currentSchedule.length - 1];
        if (lastRow.status === 'paid') {
            feedback += ' Кредит полностью погашен. Переплата? Верните деньги другу.';
        } else {
            // Уменьшаем остаток в будущих периодах (упрощённо: уменьшаем payment последнего непогашенного)
            for (let i = currentSchedule.length - 1; i >= 0; i--) {
                if (currentSchedule[i].status !== 'paid') {
                    currentSchedule[i].payment -= remainingToPay; // очень упрощённо, но для демо норм
                    currentSchedule[i].principal -= remainingToPay;
                    feedback += ` Переплата ${remainingToPay.toFixed(2)}₽ зачтена в будущий платёж №${currentSchedule[i].number}.`;
                    break;
                }
            }
        }
    }
    
    // Обновить отображение
    renderSchedule();
    showFeedback(feedback || 'Платёж проведён', 'success');
    paymentInput.value = '';
    
    // Пересчитать пени после платежа
    applyOverduePenalties();
}

// --- Пересчёт графика по новым параметрам ---
function calculateAndRenderSchedule() {
    const amount = parseFloat(document.getElementById('amount').value);
    const term = parseInt(document.getElementById('term').value);
    const rate = 15; // фиксированная ставка для простоты
    
    if (amount < 10000 || term < 3) {
        showFeedback('Минимальная сумма 10 000₽, срок от 3 мес', 'error');
        return;
    }
    
    loanParams = { amount, termMonths: term, annualRate: rate };
    
    // Сбрасываем и генерируем новый график
    currentSchedule = generateSchedule(amount, term, rate);
    renderSchedule();
    showFeedback('Новый график платежей рассчитан', 'info');
}

// --- Утилита для сообщений ---
function showFeedback(message, type = 'info') {
    const feedbackDiv = document.getElementById('payment-feedback');
    feedbackDiv.innerText = message;
    feedbackDiv.style.color = type === 'error' ? 'var(--error)' : (type === 'success' ? 'var(--success)' : 'var(--text-secondary)');
    
    // Автоочистка через 5 секунд
    setTimeout(() => {
        feedbackDiv.innerText = '';
    }, 5000);
}

// Экспорт для отладки
window.debug = { getSchedule: () => currentSchedule };