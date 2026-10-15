import { describe, expect, it } from "vitest";
import { nonPlayingOwnerNames, ownersOfOtherTeams, teamOwnerNames } from "@/lib/teams";
import type { Player, Team } from "@/lib/types";

const team = (id: string, name: string, owner_names: string[] = []): Team => ({
  id, name, short_name: "T", color: "#000000", sort_order: 0, owner_names, created_at: "",
});
const owner = (name: string, teamId: string): Player => ({
  id: name, name, pool: "men", role: "Batter", batting_style: null, bowling_style: null, grade: "C", base_price: 0,
  photo_url: null, notes: null, details: [], status: "sold", sold_team_id: teamId, sold_price: 4000, decided_round: null,
  waitlisted_at: null, signing: "owner", created_at: "", updated_at: "",
});

const players = [owner("amit mohol", "sr"), owner("Nikhil Dhane", "sr"), owner("Mangesh Khiratkar", "mi"), owner("Vineet Pareek", "mi"), owner("Rahul Budhe", "sk")];

describe("team owner names", () => {
  it("shows a playing owner written in Settings once, the way it was written", () => {
    const sunrisers = team("sr", "P2 Sunrisers", ["Amit Mohol", "Nikhil  Dhane (co-owner)"]);
    expect(teamOwnerNames(sunrisers, players)).toEqual(["Amit Mohol", "Nikhil  Dhane (co-owner)"]);
    expect(nonPlayingOwnerNames(sunrisers, players)).toEqual([]);
  });

  it("lists playing owners first, then owners who don't play", () => {
    const superKings = team("sk", "P2 Super Kings", ["Jitendra Shinde (co-owner)"]);
    expect(teamOwnerNames(superKings, players)).toEqual(["Rahul Budhe", "Jitendra Shinde (co-owner)"]);
    expect(nonPlayingOwnerNames(superKings, players)).toEqual(["Jitendra Shinde (co-owner)"]);
    const royals = team("rr", "P2 Royals", ["Yogendra Deoskar", "Praveen Ganegaonkar (co-owner)"]);
    expect(teamOwnerNames(royals, players)).toEqual(["Yogendra Deoskar", "Praveen Ganegaonkar (co-owner)"]);
    expect(teamOwnerNames(team("x", "X"), [])).toEqual([]);
  });

  it("spots another team's playing owners typed by mistake", () => {
    const teams = [team("sr", "P2 Sunrisers"), team("mi", "P2 Indians")];
    expect(ownersOfOtherTeams("mi", ["Amit Mohol", "Nikhil Dhane (co-owner)", "Someone Else"], players, teams)).toEqual([
      { name: "Amit Mohol", team: "P2 Sunrisers" },
      { name: "Nikhil Dhane (co-owner)", team: "P2 Sunrisers" },
    ]);
    expect(ownersOfOtherTeams("sr", ["Amit Mohol"], players, teams)).toEqual([]);
  });
});
