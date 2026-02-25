// Состояние приложения
let currentSchedule = [];
let loanParams = {
    amount: 100000,
    termMonths: 12,
    annualRate: 12.5 // Исправлено: теперь 12.5% как в сервере
};
let nextPaymentDate = new Date();
let remainingDebt = 0;

// Инициализация при запуске
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Script.js инициализирован');
    setupEventListeners();
    // Устанавливаем начальные значения для калькулятора
    document.getElementById('amount').value = 500000;
    document.getElementById('term').value = 24;
    calculateAndRenderSchedule();
    
    // Запускаем проверку пеней каждый час
    setInterval(applyOverduePenalties, 1000 * 60 * 60);
});

function setupEventListeners() {
    const applyBtn = document.getElementById('apply-params');
    if (applyBtn) {
        applyBtn.addEventListener('click', calculateAndRenderSchedule);
    }
    
    const paymentBtn = document.getElementById('make-payment');
    if (paymentBtn) {
        paymentBtn.addEventListener('click', handlePayment);
    }
    
    // Валидация ввода
    const amountInput = document.getElementById('amount');
    const termInput = document.getElementById('term');
    
    if (amountInput) {
        amountInput.addEventListener('input', function() {
            let val = parseInt(this.value);
            if (val < 10000) this.value = 10000;
            if (val > 5000000) this.value = 5000000;
        });
    }
    
    if (termInput) {
        termInput.addEventListener('input', function() {
            let val = parseInt(this.value);
            if (val < 6) this.value = 6;
            if (val > 60) this.value = 60;
        });
    }
}

// Расчет аннуитетного платежа
function calculateAnnuity(amount, months, ratePerYear) {
    const monthlyRate = ratePerYear / 100 / 12;
    if (monthlyRate === 0) return amount / months;
    
    // Правильная формула аннуитета
    const annuityFactor = (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
    return amount * annuityFactor;
}

// Генерация графика платежей
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
        
        // Корректировка для последнего платежа
        if (principal > balance) {
            principal = balance;
        }
        
        balance -= principal;
        if (balance < 0.01) balance = 0; // защита от копеек
        
        const paymentDate = new Date(currentDate);
        paymentDate.setMonth(currentDate.getMonth() + i);
        
        schedule.push({
            number: i,
            dueDate: paymentDate.toISOString().split('T')[0],
            payment: monthlyPayment,
            principal: principal,
            interest: interest,
            remaining: Math.max(0, balance),
            status: 'pending',
            paidAmount: 0,
            paidDate: null,
            penalty: 0,
            penaltyDays: 0
        });
    }
    return schedule;
}

// Рендер графика
function renderSchedule() {
    const tbody = document.getElementById('schedule-body');
    if (!tbody) return;
    
    if (!currentSchedule.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-table">График не рассчитан</td></tr>';
        return;
    }
    
    let html = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    currentSchedule.forEach(row => {
        const dueDate = new Date(row.dueDate + 'T12:00:00');
        const isOverdue = (row.status === 'pending' && dueDate < today);
        const rowClass = isOverdue ? 'overdue-row' : '';
        
        let statusBadge = '';
        if (row.status === 'paid') {
            statusBadge = '<span class="status-badge status-paid">✅ Оплачено</span>';
        } else if (isOverdue) {
            statusBadge = '<span class="status-badge status-overdue">⚠️ Просрочка</span>';
        } else {
            statusBadge = '<span class="status-badge status-pending">⏳ Ожидается</span>';
        }
        
        // Отображение суммы с учетом пеней
        const displayAmount = row.penalty > 0 
            ? `${(row.payment + row.penalty).toFixed(2)} ₽ (пеня ${row.penalty.toFixed(2)} ₽)`
            : `${row.payment.toFixed(2)} ₽`;
        
        html += `<tr class="${rowClass}">
            <td>${row.number}</td>
            <td>${row.dueDate}</td>
            <td>${displayAmount}</td>
            <td>${row.principal.toFixed(2)} ₽</td>
            <td>${row.interest.toFixed(2)} ₽</td>
            <td>${row.remaining.toFixed(2)} ₽</td>
            <td>${statusBadge}</td>
        </tr>`;
    });
    
    tbody.innerHTML = html;
    updateSummary();
}

// Обновление сводки
function updateSummary() {
    const summaryDiv = document.getElementById('loanSummary');
    if (!summaryDiv) return;
    
    if (!currentSchedule.length) {
        summaryDiv.style.display = 'none';
        return;
    }
    
    summaryDiv.style.display = 'block';
    
    // Остаток долга
    const lastRow = currentSchedule[currentSchedule.length - 1];
    remainingDebt = lastRow.remaining;
    
    // Расчет просрочки и пеней
    let overdueTotal = 0;
    let totalPenalty = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    currentSchedule.forEach(row => {
        if (row.status !== 'paid') {
            const dueDate = new Date(row.dueDate + 'T12:00:00');
            if (dueDate < today) {
                const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                const penalty = row.payment * 0.001 * daysOverdue;
                overdueTotal += row.payment - (row.paidAmount || 0);
                totalPenalty += penalty;
            }
        }
    });
    
    // Следующий платеж
    let nextPayment = null;
    for (let row of currentSchedule) {
        if (row.status !== 'paid') {
            nextPayment = row;
            break;
        }
    }
    
    // Обновляем DOM
    const remainingEl = document.getElementById('remainingDebt');
    const overdueEl = document.getElementById('overdueInfo');
    const nextPaymentEl = document.getElementById('nextPaymentInfo');
    
    if (remainingEl) remainingEl.innerText = remainingDebt.toFixed(2) + ' ₽';
    if (overdueEl) {
        overdueEl.innerHTML = totalPenalty > 0 
            ? `${totalPenalty.toFixed(2)} ₽ (${overdueTotal.toFixed(2)} ₽ просрочка)`
            : '0 ₽';
    }
    
    if (nextPaymentEl && nextPayment) {
        const totalDue = nextPayment.payment + (nextPayment.penalty || 0);
        nextPaymentEl.innerHTML = `${totalDue.toFixed(2)} ₽ (до ${nextPayment.dueDate})`;
    } else if (nextPaymentEl) {
        nextPaymentEl.innerText = 'Кредит погашен';
    }
}

// Начисление пеней
function applyOverduePenalties() {
    if (!currentSchedule.length) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let changes = false;
    
    currentSchedule.forEach(row => {
        if (row.status === 'paid') return;
        
        const dueDate = new Date(row.dueDate + 'T12:00:00');
        if (dueDate >= today) return;
        
        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        if (daysOverdue <= 0) return;
        
        const penalty = row.payment * 0.001 * daysOverdue;
        
        // Обновляем только если пеня изменилась
        if (Math.abs(penalty - (row.penalty || 0)) > 0.01) {
            row.penalty = penalty;
            row.penaltyDays = daysOverdue;
            changes = true;
        }
    });
    
    if (changes) {
        renderSchedule();
        showFeedback('⚠️ Начислены пени за просрочку', 'warning');
    }
}

// Обработка платежа
function handlePayment() {
    const paymentInput = document.getElementById('payment-amount');
    if (!paymentInput) return;
    
    let paymentAmount = parseFloat(paymentInput.value);
    
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
        showFeedback('❌ Введите корректную сумму платежа', 'error');
        return;
    }
    
    if (!currentSchedule.length) {
        showFeedback('❌ Сначала рассчитайте кредит', 'error');
        return;
    }
    
    let remainingToPay = paymentAmount;
    const today = new Date().toISOString().split('T')[0];
    let feedback = '';
    
    // Проходим по всем непогашенным платежам по порядку
    for (let i = 0; i < currentSchedule.length; i++) {
        const row = currentSchedule[i];
        if (row.status === 'paid') continue;
        
        const totalDue = row.payment + (row.penalty || 0);
        const paidSoFar = row.paidAmount || 0;
        const dueForThisPeriod = totalDue - paidSoFar;
        
        if (dueForThisPeriod <= 0) continue;
        
        if (remainingToPay >= dueForThisPeriod) {
            // Полностью закрываем этот платеж
            remainingToPay -= dueForThisPeriod;
            row.status = 'paid';
            row.paidAmount = totalDue;
            row.paidDate = today;
            feedback += `✅ Платёж №${row.number} полностью погашен. `;
        } else {
            // Частичная оплата
            row.paidAmount = (row.paidAmount || 0) + remainingToPay;
            const newDue = totalDue - row.paidAmount;
            feedback += `💰 Внесено ${remainingToPay.toFixed(2)}₽. Осталось по платежу №${row.number}: ${newDue.toFixed(2)}₽. `;
            remainingToPay = 0;
            break;
        }
        
        if (remainingToPay <= 0) break;
    }
    
    if (remainingToPay > 0) {
        feedback += `💫 Переплата ${remainingToPay.toFixed(2)}₽ зачтена в будущие платежи.`;
        
        // Уменьшаем остаток в будущих периодах
        for (let i = currentSchedule.length - 1; i >= 0; i--) {
            if (currentSchedule[i].status !== 'paid') {
                currentSchedule[i].payment -= remainingToPay;
                currentSchedule[i].principal -= remainingToPay;
                break;
            }
        }
    }
    
    // Обновляем отображение
    renderSchedule();
    showFeedback(feedback || '✅ Платёж проведён', 'success');
    paymentInput.value = '';
    
    // Пересчитываем пени после платежа
    applyOverduePenalties();
}

// Пересчет графика
function calculateAndRenderSchedule() {
    const amountInput = document.getElementById('amount');
    const termInput = document.getElementById('term');
    
    if (!amountInput || !termInput) return;
    
    const amount = parseFloat(amountInput.value);
    const term = parseInt(termInput.value);
    const rate = 12.5; // Фиксированная ставка 12.5%
    
    if (amount < 10000 || term < 6) {
        showFeedback('❌ Минимальная сумма 10 000₽, срок от 6 мес', 'error');
        return;
    }
    
    if (amount > 5000000 || term > 60) {
        showFeedback('❌ Максимальная сумма 5 000 000₽, срок до 60 мес', 'error');
        return;
    }
    
    loanParams = { amount, termMonths: term, annualRate: rate };
    
    // Генерируем новый график
    currentSchedule = generateSchedule(amount, term, rate);
    renderSchedule();
    showFeedback('✅ Новый график платежей рассчитан', 'success');
}

// Показать сообщение
function showFeedback(message, type = 'info') {
    const feedbackDiv = document.getElementById('payment-feedback');
    if (!feedbackDiv) return;
    
    feedbackDiv.innerText = message;
    feedbackDiv.className = `feedback-message ${type}`;
    
    // Автоочистка через 5 секунд
    setTimeout(() => {
        feedbackDiv.innerText = '';
        feedbackDiv.className = '';
    }, 5000);
}

// Форматирование числа
function formatNumber(num) {
    return new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(num);
}

// Экспорт для отладки
window.debug = { 
    getSchedule: () => currentSchedule,
    calculateAnnuity: calculateAnnuity
};