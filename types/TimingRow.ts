export interface TimingRow {
    id: number;
    event_name: string;
    event_time: number;   
    channel_id: string;
    guild_id: string;
    msg: string;
    type: "once" | "daily" | "weekly" | "monthly";
    board_channel_id: string | null;
    board_msg_id: string | null;
}