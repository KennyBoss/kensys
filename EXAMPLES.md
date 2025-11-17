# 📚 Примеры использования kensys

## Пример 1: Анализ казино-приложения

### Команда
```bash
kensys analyze ./casino-app --output casino-codex.json
```

### Результат (casino-codex.json)

```json
{
  "projectName": "casino-app",
  "language": "typescript",
  "filesAnalyzed": 45,
  "features": [
    {
      "name": "balance",
      "description": "Feature: balance",
      "functions": [
        {
          "name": "getBalance",
          "type": "function",
          "params": ["userId"],
          "calls": ["db.query", "validateUser"],
          "calledBy": ["updateBalance", "checkBalance", "UI_dashboard"],
          "logic": "SELECT balance FROM users WHERE id = userId",
          "location": { "file": "src/balance/service.ts", "line": 12 }
        },
        {
          "name": "updateBalance",
          "type": "function",
          "params": ["userId", "amount"],
          "calls": ["getBalance", "checkLimit", "logTransaction", "emitEvent"],
          "calledBy": ["deposit", "withdraw", "processWin"],
          "logic": "const newBalance = oldBalance + amount; if (newBalance < 0) throw InsufficientFundsError; UPDATE users SET balance = newBalance"
        },
        {
          "name": "checkBalance",
          "type": "function",
          "params": ["userId", "requiredAmount"],
          "calls": ["getBalance"],
          "calledBy": ["canPlayGame", "canBet"]
        },
        {
          "name": "transferBalance",
          "type": "function",
          "params": ["fromId", "toId", "amount"],
          "calls": ["checkBalance", "updateBalance", "logTransaction"]
        }
      ],
      "files": ["src/balance/service.ts", "src/balance/controller.ts"],
      "dependencies": ["database", "logging"],
      "missingFunctions": [
        "rollbackBalance - для отката неудачных транзакций",
        "balanceHistory - для логирования истории",
        "calculateBonus - бонусная система"
      ]
    },
    {
      "name": "betting",
      "description": "Feature: betting",
      "functions": [
        {
          "name": "placeBet",
          "calls": ["checkBalance", "calculateOdds", "createBetRecord"],
          "calledBy": ["gameController"]
        },
        {
          "name": "calculateWin",
          "calls": ["calculateOdds", "updateBalance"],
          "calledBy": ["endGame"]
        },
        {
          "name": "processBet",
          "calls": ["placeBet", "calculateWin", "logBet"]
        }
      ],
      "files": ["src/betting/service.ts"],
      "dependencies": ["balance", "games"],
      "missingFunctions": [
        "betValidation - проверка корректности ставки",
        "betLimit - ограничение макс ставки"
      ]
    },
    {
      "name": "games",
      "description": "Feature: games",
      "functions": [
        {
          "name": "startGame",
          "calls": ["createGame", "initializeState"],
          "calledBy": ["gameController"]
        },
        {
          "name": "endGame",
          "calls": ["calculateWin", "updateBalance", "logGame"],
          "calledBy": ["gameEngine"]
        },
        {
          "name": "updateScore",
          "calls": ["updateGameState", "emitUpdate"]
        }
      ],
      "files": ["src/games/service.ts", "src/games/engine.ts"],
      "dependencies": ["balance", "betting"]
    }
  ],
  "allFunctions": [
    /* 120+ функций */
  ],
  "dependencies": {
    "nodes": {
      "getBalance@src/balance/service.ts": { "id": "getBalance", "type": "function", "name": "getBalance" },
      "updateBalance@src/balance/service.ts": { "id": "updateBalance", "type": "function", "name": "updateBalance" }
      /* больше узлов */
    },
    "edges": [
      { "from": "updateBalance@src/balance/service.ts", "to": "getBalance@src/balance/service.ts", "type": "calls" },
      { "from": "processBet@src/betting/service.ts", "to": "placeBet@src/betting/service.ts", "type": "calls" }
      /* больше рёбер */
    ]
  }
}
```

---

## Как AI использует это

### Сценарий 1: Добавление отката баланса

```
Пользователь: "Добавь функцию rollbackBalance"

Claude:
1. Читает кодекс → видит:
   - updateBalance вызывает logTransaction
   - она используется в deposit, withdraw, processWin
   - есть zависимость на database

2. Создаёт функцию:
   - С правильной сигнатурой (как updateBalance)
   - С правильными зависимостями (database, logging)
   - Вызывает нужные функции для отката

3. Результат: ✅ Правильная функция с первого раза!
```

### Сценарий 2: Поиск баугов

```
Пользователь: "Почему баланс может стать отрицательным?"

Claude анализирует кодекс:
- getBalance ✓ (просто читает)
- updateBalance ✓ (проверяет checkLimit)
- checkBalance ✓ (для проверки перед ставкой)
- но transferBalance ✗ вызывает updateBalance дважды!

Результат: "Найден баг в transferBalance!"
```

---

## Пример 2: React приложение

### Команда
```bash
kensys analyze ./my-react-app
```

### Кодекс
```json
{
  "projectName": "my-react-app",
  "language": "typescript,javascript,jsx",
  "features": [
    {
      "name": "components",
      "functions": [
        {
          "name": "Button",
          "type": "arrow",
          "params": ["props"],
          "calls": ["onClick", "className"]
        },
        {
          "name": "Dashboard",
          "type": "arrow",
          "params": ["userId"],
          "calls": ["useState", "useEffect", "getBalance", "Button", "UserInfo"]
        }
      ]
    },
    {
      "name": "hooks",
      "functions": [
        {
          "name": "useBalance",
          "calls": ["useState", "useEffect", "api.getBalance"]
        }
      ]
    },
    {
      "name": "api",
      "functions": [
        {
          "name": "getBalance",
          "calls": ["fetch"],
          "calledBy": ["useBalance", "Dashboard", "AdminPanel"]
        }
      ]
    }
  ]
}
```

---

## Использование в скрипте

```python
# Python скрипт анализирует кодекс
import json

with open('casino-codex.json') as f:
    codex = json.load(f)

# Находим функцию
balance_feature = next(f for f in codex['features'] if f['name'] == 'balance')
missing = balance_feature['missingFunctions']

print(f"Нужно добавить: {missing}")
# Output: Нужно добавить: ['rollbackBalance', 'balanceHistory', 'calculateBonus']
```

---

## Интеграция с IDE (future)

```
// VS Code
kensys analyze .
// → Показать все фичи в боковой панели
// → Навигация по функциям
// → Граф зависимостей в редакторе
```

---

## Таблица сравнения

| Функция | kensys | grep | IDE | Comments |
|---------|--------|------|-----|----------|
| Найти функцию | ⚡ Да | Окей | ✅ Хорошо | кодекс - быстро |
| Зависимости | ✅ Да | ❌ Нет | ⚠️ Частично | кодекс - полная информация |
| AI-friendly | ✅ Да | ❌ Нет | ❌ Нет | структурированный JSON |
| Граф | ✅ Да | ❌ Нет | ⚠️ Иногда | видеть связи сразу |
| Недостающие функции | ✅ Да | ❌ Нет | ❌ Нет | только kensys |

---

## 🚀 Готово к использованию!

```bash
# 1. Анализируешь проект
kensys analyze ./my-project

# 2. Даёшь кодекс AI
# Claude/Gemini читает codex.json

# 3. AI работает как профессионал 🎯
# - Знает всю архитектуру
# - Не запутывается
# - Добавляет функции правильно
```
