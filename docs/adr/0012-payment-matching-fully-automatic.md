# Payments are matched automatically by amount and time, with no unique amount and no manual tie-breaking

The goal of the shop is to confirm payments without people. Humo credit notifications carry no operation id and no sender, so a credit can only be matched on amount and minute-precision time. We decided against a per-order unique amount (subtracting 1–99 so'm): customers round transfers in practice, which would push every rounded payment to a manager.

AI reads the receipt (amount, date-time, recipient card last-4) and confirms the order when an unclaimed Humo credit has the **same amount as the order total and the receipt**, the recipient card is the shop's, and the times differ by at most the match window (admin setting). When several unclaimed credits fit, the system takes the one closest in time instead of sending the order to a manager (a deviation from TZ §4 "несколько поступлений → вручную"). A credit is never linked to two orders.

Accepted risk: a forged screenshot whose amount and time coincide with someone else's real same-amount credit can be confirmed automatically, and the honest payer's receipt then finds no free credit. Decided knowingly on 2026-11-07.

## Considered Options

- **Unique amount per order** — rejected: customers round the amount, so it would create manual work instead of removing it.
- **Auto-confirm only when exactly one open order has that amount** — rejected: every same-amount collision would need a person.

## Receipts with no money behind them

A receipt stays «Чек на проверке» and is re-matched on every new credit. If no fitting credit arrives within the wait window (admin setting, default 2 h), the system does **not** reject it: the receipt gets the verdict "payment not found", the order goes back to «Ожидает оплаты», and the customer is asked to check the amount and card and upload again, with a «Написать менеджеру» button. If the reserve has already run out, the order is cancelled automatically. The orders group gets an informational post with no required action. Rejection stays manager-only (TZ §4). While the userbot is down or Humo has been silent longer than the alert threshold, all receipt timers pause and the owner is alerted, so an outage never cancels paid orders.

Superseded in part by ADR 0013: among several candidate credits, the AI's choice of the receipt's date-time picks the credit, not "closest in time".
