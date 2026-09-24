import { VerifyQuestion } from "../types/Application.js";

// Every answerable choice in the application lives here so the guild can
// re-balance builds / weapons after a game patch without touching the
// interaction plumbing in applicationFlow.ts.

export interface ChoiceOption {
    label: string;
    value: string;
    description?: string;
}

export const PLAYER_TYPES: ChoiceOption[] = [
    { label: "Competitive", value: "competitive", description: "I play to win. I show up for every war and I optimise my build." },
    { label: "Semi-competitive", value: "semi_competitive", description: "I take it seriously but I am not online every single day." },
    { label: "Casual", value: "casual", description: "I play for fun and join events when I have the free time." }
];

export const CONTENT_TYPES: ChoiceOption[] = [
    { label: "GvG - Guild vs Guild (PvP)", value: "gvg", description: "Arena, guild wars and player-versus-player fighting." },
    { label: "GvE - Guild vs Environment (PvE)", value: "gve", description: "Bosses, dungeons and PvE speedrun content." }
];

export const ACTIVITY_ANSWERS: ChoiceOption[] = [
    { label: "Yes - I can hit 3k activity every week", value: "yes" },
    { label: "No - I cannot commit to that", value: "no" }
];

export const PATH_BUILDS: ChoiceOption[] = [
    { label: "Bellstrike - Splendor", value: "bellstrike_splendor" },
    { label: "Bellstrike - Umbra", value: "bellstrike_umbra" },
    { label: "Stonesplit - Might", value: "stonesplit_might" },
    { label: "Stonesplit - Strength", value: "stonesplit_strength" },
    { label: "Silkbind - Jade", value: "silkbind_jade" },
    { label: "Silkbind - Deluge", value: "silkbind_deluge" },
    { label: "Bamboocut - Wind", value: "bamboocut_wind" },
    { label: "Bamboocut - Dust", value: "bamboocut_dust" },
    { label: "Bamboocut - Kite", value: "bamboocut_kite" },
    { label: "Bamboocut - Draught", value: "bamboocut_draught" }
];

export const WEAPONS: ChoiceOption[] = [
    { label: "Heavenwill Gauntlets", value: "heavenwill_gauntlets" },
    { label: "Skystrike Gauntlets", value: "skystrike_gauntlets" },
    { label: "Snowparting Blade", value: "snowparting_blade" },
    { label: "Phalanxbane Blade", value: "phalanxbane_blade" },
    { label: "Thundercry Blade", value: "thundercry_blade" },
    { label: "Infernal Twinblades", value: "infernal_twinblades" },
    { label: "Riven Twinblades", value: "riven_twinblades" },
    { label: "Mortal Rope Dart", value: "mortal_rope_dart" },
    { label: "Skygrasp Rope Dart", value: "skygrasp_rope_dart" },
    { label: "Unfettered Rope Dart", value: "unfettered_rope_dart" },
    { label: "Everspring Umbrella", value: "everspring_umbrella" },
    { label: "Soulshade Umbrella", value: "soulshade_umbrella" },
    { label: "Vernal Umbrella", value: "vernal_umbrella" },
    { label: "Stormbreaker Spear", value: "stormbreaker_spear" },
    { label: "Heavenquaker Spear", value: "heavenquaker_spear" },
    { label: "Nameless Spear", value: "nameless_spear" },
    { label: "Panacea Fan", value: "panacea_fan" },
    { label: "Inkwell Fan", value: "inkwell_fan" },
    { label: "Nameless Sword", value: "nameless_sword" },
    { label: "Strategic Sword", value: "strategic_sword" }
];

export function labelOf(options: ChoiceOption[], value: string | null | undefined): string {
    if (!value) return "-";
    return options.find(o => o.value === value)?.label ?? value;
}

export function labelsOf(options: ChoiceOption[], values: string[] | null | undefined): string {
    if (!values || values.length === 0) return "-";
    return values.map(v => labelOf(options, v)).join(", ");
}

function rand(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(list: T[]): T {
    return list[rand(0, list.length - 1)];
}

// Order of operations rather than plain addition: a copy-paste bot answers
// these fine, but a human who is not reading carefully gets them wrong too,
// which is the point of the check.
function mathQuestion(): VerifyQuestion {
    const a = rand(2, 9);
    const b = rand(2, 9);
    const c = rand(2, 9);

    if (Math.random() < 0.5) {
        return { prompt: `What is ${a} + ${b} x ${c}?`, answers: [String(a + b * c)] };
    }
    return { prompt: `What is ${a} x ${b} - ${c}?`, answers: [String(a * b - c)] };
}

function logicQuestion(): VerifyQuestion {
    const builders: (() => VerifyQuestion)[] = [
        () => {
            const offset = rand(1, 9);
            const local = (20 + offset) % 24;
            const hh = String(local).padStart(2, "0");
            return {
                prompt: `Guild War starts at 20:00 UTC. You live in UTC+${offset}. What time does it start for you? (24h format, e.g. 07:00)`,
                answers: [`${hh}:00`, String(local), `${hh}00`, `${local}:00`]
            };
        },
        () => {
            const mins = rand(2, 9);
            const secs = rand(10, 59);
            return {
                prompt: `A boss run took ${mins} minutes and ${secs} seconds. How many seconds is that in total?`,
                answers: [String(mins * 60 + secs)]
            };
        },
        () => {
            const start = rand(2, 5);
            return {
                prompt: `What number comes next in this sequence: ${start}, ${start * 2}, ${start * 4}, ${start * 8}, ?`,
                answers: [String(start * 16)]
            };
        },
        () => ({
            prompt: `Every GvG player in our guild runs two weapons. Rin runs two weapons. Does that prove Rin is a GvG player? Answer yes or no.`,
            answers: ["no", "nope", "n"]
        }),
        () => {
            const total = rand(6, 9);
            const slots = rand(2, 5);
            return {
                prompt: `You own ${total} innerways but you can only equip ${slots} at a time. How many stay unequipped?`,
                answers: [String(total - slots)]
            };
        },
        () => {
            const members = rand(3, 8);
            const each = rand(2, 5);
            return {
                prompt: `A ${members} player squad each needs ${each} revive pills. How many pills does the squad need in total?`,
                answers: [String(members * each)]
            };
        }
    ];

    return pick(builders)();
}

export function buildVerifyQuestions(): VerifyQuestion[] {
    return [mathQuestion(), logicQuestion()];
}

function normalizeAnswer(input: string): string {
    return input.toLowerCase().trim().replace(/[\s.,!"']/g, "");
}

export function checkAnswer(question: VerifyQuestion, given: string): boolean {
    const answer = normalizeAnswer(given);
    return question.answers.some(a => normalizeAnswer(a) === answer);
}
