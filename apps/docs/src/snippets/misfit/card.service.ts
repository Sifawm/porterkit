import { Injectable } from '@nestjs/common';
import type { Card } from './game';

const deck: Card[] = [
  { category: 'basics', question: 'Which of these does not fly?' },
  { category: 'spicy', question: 'Who would survive a week alone?' },
];

@Injectable()
export class CardService {
  async count() {
    return deck.length;
  }

  async random(shown: Card[]) {
    return deck.find((card) => !shown.includes(card)) ?? deck[0];
  }
}
