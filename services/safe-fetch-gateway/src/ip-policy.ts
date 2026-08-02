import { isIP } from "node:net";
import { SafeFetchError } from "./errors.js";

export type ResolvedAddress = { address: string; family: 4 | 6 };

function ipv4Value(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/u.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inIpv4Range(value: number, base: string, bits: number) {
  const baseValue = ipv4Value(base);
  if (baseValue === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

const forbiddenIpv4Ranges: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function parseIpv6(address: string): bigint | null {
  if (address.includes("%")) return null;
  let normalized = address.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  const possibleIpv4 = normalized.slice(lastColon + 1);
  if (possibleIpv4.includes(".")) {
    const ipv4 = ipv4Value(possibleIpv4);
    if (ipv4 === null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) {
    return null;
  }
  return groups.reduce(
    (value, group) => (value << BigInt(16)) | BigInt(`0x${group}`),
    BigInt(0),
  );
}

function inIpv6Range(value: bigint, base: string, bits: number) {
  const baseValue = parseIpv6(base);
  if (baseValue === null) return false;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (baseValue >> shift);
}

const forbiddenIpv6Ranges: ReadonlyArray<readonly [string, number]> = [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

export function isForbiddenIp(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Value(address);
    return value === null || forbiddenIpv4Ranges.some(
      ([base, bits]) => inIpv4Range(value, base, bits),
    );
  }
  if (family !== 6) return true;

  const value = parseIpv6(address);
  if (value === null) return true;
  const mappedPrefix = parseIpv6("::ffff:0:0");
  if (
    mappedPrefix !== null
    && (value >> BigInt(32)) === (mappedPrefix >> BigInt(32))
  ) {
    const mapped = Number(value & BigInt("0xffffffff")) >>> 0;
    return forbiddenIpv4Ranges.some(
      ([base, bits]) => inIpv4Range(mapped, base, bits),
    );
  }
  return forbiddenIpv6Ranges.some(
    ([base, bits]) => inIpv6Range(value, base, bits),
  );
}

export function assertPublicAddresses(
  addresses: ReadonlyArray<ResolvedAddress>,
): asserts addresses is ReadonlyArray<ResolvedAddress> {
  if (
    addresses.length === 0
    || addresses.some(({ address, family }) => isIP(address) !== family || isForbiddenIp(address))
  ) {
    throw new SafeFetchError("URL_NOT_ALLOWED");
  }
}
