import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import type { GameName, GamesMap } from '@porterkit/contracts';
import type { AnyContext, AnyDefinition, ManagerMethods, User } from './types';

const DEFINITION = 'porter:definition';
const HANDLERS = 'porter:handlers';
const ADMIN_ONLY = 'porter:adminOnly';
const ANY_TIME = 'porter:anyTime';

export interface Handler {
  method: string;
  guard?: (data: unknown) => boolean;
  adminOnly: boolean;
  anyTime: boolean;
}

/** The interface every Manager implements. */
export interface GameManager<Ctx extends AnyContext> extends ManagerMethods<Ctx> {}

/** Marks a class as the Manager of that Game definition. Also applies `@Injectable()`. */
export function GameManager(definition: AnyDefinition): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(DEFINITION, definition, target);
    Injectable()(target);
  };
}

/** The typed message decorator of one Game: `const On = handlersOf<Games, 'misfit'>()`. */
export function handlersOf<Games extends GamesMap, Name extends GameName<Games>>(): <
  E extends keyof Games[Name]['client'] & string,
>(
  event: E,
  ...guard: [Games[Name]['client'][E]] extends [undefined]
    ? []
    : [accepts: (data: unknown) => data is Games[Name]['client'][E]]
) => (
  target: object,
  method: string,
  descriptor: {
    value?: (ctx: any, data: Games[Name]['client'][E], user: User<any, any>) => unknown;
  },
) => void {
  return (event: string, guard?: (data: unknown) => boolean) => (target: object, method: string) => {
    const own: [string, string, typeof guard][] = [...(Reflect.getMetadata(HANDLERS, target) ?? [])];
    own.push([event, method, guard]);
    Reflect.defineMetadata(HANDLERS, own, target);
  };
}

/** The message is for the Admin only. */
export function AdminOnly(): MethodDecorator {
  return (target, method) => Reflect.defineMetadata(ADMIN_ONLY, true, target, method);
}

/** The message is delivered with or without a Match under way. */
export function AnyTime(): MethodDecorator {
  return (target, method) => Reflect.defineMetadata(ANY_TIME, true, target, method);
}

/** The Game definition a class was marked with, if any. */
export function definitionOf(type: object): AnyDefinition | undefined {
  return Reflect.getMetadata(DEFINITION, type);
}

/** A Manager's handlers by event. Read once the class is fully decorated. */
export function handlersIn(manager: object): Map<string, Handler> {
  const proto = Object.getPrototypeOf(manager);
  const handlers = new Map<string, Handler>();
  for (const [event, method, guard] of Reflect.getMetadata(HANDLERS, proto) ?? []) {
    handlers.set(event, {
      method,
      guard,
      adminOnly: Reflect.getMetadata(ADMIN_ONLY, proto, method) === true,
      anyTime: Reflect.getMetadata(ANY_TIME, proto, method) === true,
    });
  }
  return handlers;
}
