import { SET_SIZE, type ProfitabilityQuote, type SalesChannel } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { Notice } from '@/components/ui/notice';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';
import { OrderCostRows, ProfitLine, Row, UnitCostRows, percentValue } from './cost-rows';

const HEADING = 'font-display text-[13px] leading-[1.35] tracking-[0.2em] uppercase';

type Line = ProfitabilityQuote['lines'][number];

function lineName(l: Line, t: AdminMessages) {
  const p = t.profitability;
  return l.item.kind === 'discovery_set'
    ? fill(p.discoverySetFull, { n: String(SET_SIZE), ml: String(l.ml) })
    : `${l.name}, ${fill(p.ml, { ml: String(l.ml) })}`;
}

/** No unit cost: which fragrances lack an oil price. */
function NoCost({ quote, t }: { quote: ProfitabilityQuote; t: AdminMessages }) {
  return (
    <Notice
      title={fill(t.profitability.noCost, {
        names: quote.missing.join(', ') || t.profitability.discoverySet,
      })}
    />
  );
}

/**
 * The calculator's answer (#77): the unit cost part by part, the price the customer pays (the
 * after-set discount taken off a Full size bottle), the order costs and the profit with its margin.
 */
export function CalculatorResult({
  quote,
  channel,
  lowMarginPercent,
  language,
  t,
}: {
  quote: ProfitabilityQuote;
  channel: SalesChannel;
  lowMarginPercent: number;
  language: Language;
  t: AdminMessages;
}) {
  const p = t.profitability;
  const c = p.calculator;
  const money = (n: number) => formatMoney(n, language);
  const line = quote.lines[0]!;
  return (
    <Card className="@container grid gap-6 p-4 sm:p-6" data-testid="calculator-result">
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold break-words">{lineName(line, t)}</h2>
        <MetaLine
          className="mt-0.5 text-small text-muted-foreground"
          parts={[
            line.brand && fill(t.reports.attribution, { brand: line.brand }),
            p.channels[channel],
          ]}
        />
      </div>
      <div className="grid gap-6 @2xl:grid-cols-2 @2xl:gap-8">
        <section className="grid content-start gap-3">
          <h3 className={HEADING}>{c.unitCost}</h3>
          {line.unitCost ? (
            <UnitCostRows cost={line.unitCost} language={language} t={t} />
          ) : (
            <NoCost quote={quote} t={t} />
          )}
        </section>
        <div className="grid content-start gap-6">
          <section className="grid gap-3">
            <h3 className={HEADING}>{c.price}</h3>
            <dl className="grid gap-1.5 text-sm">
              {quote.discount > 0 || line.markedDown ? (
                <>
                  <Row label={c.fullPrice} value={money(line.regularUnitPrice)} />
                  {line.markedDown && <Row label={p.markedDown} value={money(line.unitPrice)} />}
                  {quote.discount > 0 && (
                    <Row
                      label={fill(c.discount, {
                        percent: percentValue(quote.afterSetDiscountPercent),
                      })}
                      value={money(-quote.discount)}
                      className="[&_dd]:text-sage-ink"
                    />
                  )}
                  <Row
                    label={c.clientPrice}
                    value={money(quote.itemsSubtotal - quote.discount)}
                    strong
                  />
                </>
              ) : (
                <Row label={p.channels[channel]} value={money(line.unitPrice)} strong />
              )}
            </dl>
          </section>
          {quote.profit && (
            <section className="grid gap-3">
              <h3 className={HEADING}>{c.orderCosts}</h3>
              <OrderCostRows
                sale={quote.profit}
                language={language}
                t={t}
                goodsLabel={c.unitCost}
              />
            </section>
          )}
        </div>
      </div>
      {quote.profit && (
        <ProfitLine
          sale={quote.profit}
          lowMarginPercent={lowMarginPercent}
          language={language}
          t={t}
        />
      )}
    </Card>
  );
}

/**
 * The simulator's answer (#77): each line at the shop's price, the order sum and its delivery (free
 * from the threshold, else what the customer pays and how far the threshold is), the order costs
 * and the profit.
 */
export function OrderResult({
  quote,
  channel,
  afterSetDiscount,
  lowMarginPercent,
  language,
  t,
}: {
  quote: ProfitabilityQuote;
  channel: SalesChannel;
  afterSetDiscount: boolean;
  lowMarginPercent: number;
  language: Language;
  t: AdminMessages;
}) {
  const p = t.profitability;
  const o = p.order;
  const money = (n: number) => formatMoney(n, language);
  const app = channel === 'miniapp';
  return (
    <Card className="grid gap-5 p-4 sm:p-6" data-testid="order-result">
      <section className="grid gap-3">
        <h2 className={HEADING}>{o.items}</h2>
        <dl className="grid gap-1.5 text-sm">
          {quote.lines.map((l, i) => (
            <Row
              key={i}
              label={`${lineName(l, t)} × ${l.qty}`}
              value={money(l.lineTotal)}
              note={l.markedDown ? `${p.markedDown} · ${money(l.regularUnitPrice)}` : undefined}
            />
          ))}
          {quote.discount > 0 && (
            <Row
              label={fill(p.calculator.discount, {
                percent: percentValue(quote.afterSetDiscountPercent),
              })}
              value={money(-quote.discount)}
              className="[&_dd]:text-sage-ink"
            />
          )}
          <Row
            label={o.sum}
            value={money(quote.itemsSubtotal - quote.discount)}
            strong
            className="mt-1.5 border-t border-border pt-2.5"
          />
        </dl>
        <p className="text-small text-pretty text-muted-foreground">
          {app
            ? quote.deliveryFee === 0
              ? fill(o.freeDelivery, { threshold: money(quote.freeDeliveryThreshold) })
              : fill(o.toFree, {
                  fee: money(quote.deliveryFee),
                  amount: money(quote.amountToFreeDelivery),
                })
            : o.uzumNote}
        </p>
        {afterSetDiscount && <p className="text-small text-muted-foreground">{o.afterSetNote}</p>}
      </section>
      {quote.profit ? (
        <>
          <section className="grid gap-3">
            <h2 className={HEADING}>{p.calculator.orderCosts}</h2>
            <OrderCostRows sale={quote.profit} language={language} t={t} />
          </section>
          <ProfitLine
            sale={quote.profit}
            lowMarginPercent={lowMarginPercent}
            language={language}
            t={t}
          />
        </>
      ) : (
        <NoCost quote={quote} t={t} />
      )}
    </Card>
  );
}
