import { Icon, type P } from '../ui/icons';

/*
 * The payment screen's and checkout's own icons (#28), apart from `ui/icons` so the first screen's
 * bundle does not carry them (ADR 0030 budget). Same grid and stroke as every icon.
 */
/** Two stacked sheets: «Скопировать» (the payment screen's amount and card number). */
export const CopyIcon = (p: P) => (
  <Icon
    d="M9 8.5V6a1.5 1.5 0 0 1 1.5-1.5H18A1.5 1.5 0 0 1 19.5 6v7.5A1.5 1.5 0 0 1 18 15h-2.5M6 9h7.5A1.5 1.5 0 0 1 15 10.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18v-7.5A1.5 1.5 0 0 1 6 9z"
    {...p}
  />
);
/** An arrow up out of a tray: «Отправить чек». */
export const UploadIcon = (p: P) => (
  <Icon d="M12 15V4.5M7.5 9 12 4.5 16.5 9M4.5 14.5v4a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4" {...p} />
);
/** A framed picture: a receipt screenshot. */
export const ImageIcon = (p: P) => (
  <Icon
    d="M5 4.5h14a.5.5 0 0 1 .5.5v14a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5zM4.5 16l4.5-4.5 4 4 2.5-2.5 4 4M15 9.5a1 1 0 1 0 0-.01"
    {...p}
  />
);
/** A bank card: the payment states. */
export const CardIcon = (p: P) => (
  <Icon
    d="M4 6.5h16a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V7a.5.5 0 0 1 .5-.5zM3.5 10h17M7 14.5h3"
    {...p}
  />
);
