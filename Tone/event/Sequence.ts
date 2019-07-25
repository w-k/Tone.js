import { TicksClass } from "../core/type/Ticks";
import { omitFromObject, optionsFromArguments } from "../core/util/Defaults";
import { isArray, isString } from "../core/util/TypeCheck";
import { Part } from "./Part";
import { ToneEvent, ToneEventCallback, ToneEventOptions } from "./ToneEvent";

type SequenceEventDescription = Array<any | any[]>;

interface SequenceOptions extends Omit<ToneEventOptions, "value"> {
	loopStart: number;
	loopEnd: number;
	subdivision: Time;
	events: SequenceEventDescription;
}

/**
 * A sequence is an alternate notation of a part. Instead
 * of passing in an array of [time, event] pairs, pass
 * in an array of events which will be spaced at the
 * given subdivision. Sub-arrays will subdivide that beat
 * by the number of items are in the array.
 * Sequence notation inspiration from [Tidal](http://yaxu.org/tidal/)
 * @param  callback  The callback to invoke with every note
 * @param  sequence  The sequence
 * @param  subdivision  The subdivision between which events are placed.
 * @example
 * var seq = new Sequence(function(time, note){
 * 	console.log(note);
 * //straight quater notes
 * }, ["C4", "E4", "G4", "A4"], "4n");
 * @example
 * var seq = new Sequence(function(time, note){
 * 	console.log(note);
 * //subdivisions are given as subarrays
 * }, ["C4", ["E4", "D4", "E4"], "G4", ["A4", "G4"]]);
 */
export class Sequence extends ToneEvent {

	name = "Sequence";

	/**
	 *  The subdivison of each note
	 */
	private _subdivision: Ticks;

	/**
	 * The object responsible for scheduling all of the events
	 */
	private _part: Part = new Part({
		callback: this._seqCallback.bind(this),
		context: this.context,
	});

	/**
	 * private reference to all of the sequence proxies
	 */
	private _events: any[] = [];

	/**
	 * The proxied array
	 */
	private _eventsArray: any[] = [];

	constructor(
		callback?: ToneEventCallback,
		events?: SequenceEventDescription,
		subdivision?: Time,
	);
	constructor(options?: Partial<SequenceOptions>);
	constructor() {

		super(optionsFromArguments(Sequence.getDefaults(), arguments, ["callback", "events", "subdivision"]));
		const options = optionsFromArguments(Sequence.getDefaults(), arguments, ["callback", "events", "subdivision"]);

		this._subdivision = this.toTicks(options.subdivision);

		this.events = options.events;

		// set all of the values
		this.loop = options.loop;
		this.loopStart = options.loopStart;
		this.loopEnd = options.loopEnd;
		this.playbackRate = options.playbackRate;
		this.probability = options.probability;
		this.humanize = options.humanize;
		this.mute = options.mute;
		this.playbackRate = options.playbackRate;
	}

	static getDefaults(): SequenceOptions {
		return Object.assign( omitFromObject(ToneEvent.getDefaults(), ["value"]), {
			events: [],
			loop: true,
			loopEnd : 0,
			loopStart: 0,
			subdivision: "8n",
		});
	}

	/**
	 * The internal callback for when an event is invoked
	 */
	private _seqCallback(time: Seconds, value: any): void {
		if (value !== null) {
			this.callback(time, value);
		}
	}

	/**
	 * The sequence
	 */
	get events(): any[] {
		return this._events;
	}
	set events(s) {
		this.clear();
		this._eventsArray = s;
		this._events = this._createSequence(this._eventsArray);
		this._eventsUpdated();
	}

	/**
	 *  Start the part at the given time.
	 *  @param  time    When to start the part.
	 *  @param  offset  The offset index to start at
	 */
	start(time?: TransportTime, offset?: number): this {
		this._part.start(time, offset ? this._indexTime(offset) : offset);
		return this;
	}

	/**
	 *  Stop the part at the given time.
	 *  @param  time  When to stop the part.
	 */
	stop(time?: TransportTime): this {
		this._part.stop(time);
		return this;
	}

	/**
	 *  The subdivision of the sequence. This can only be
	 *  set in the constructor. The subdivision is the
	 *  interval between successive steps.
	 */
	get subdivision(): Seconds {
		return new TicksClass(this.context, this._subdivision).toSeconds();
	}

	/**
	 * Create a sequence proxy which can be monitored to create subsequences
	 */
	private _createSequence(array: any[]): any[] {
		return new Proxy(array, {
			get: (target: any[], property: PropertyKey): any => {
				// property is index in this case
				return target[property];
			},
			set: (target: any[], property: PropertyKey, value: any): boolean => {
				if (isString(property) && isFinite(parseInt(property, 10))) {
					const index = parseInt(property, 10);
					if (isArray(value)) {
						target[property] = this._createSequence(value);
					} else {
						target[property] = value;
					}
				} else {
					target[property] = value;
				}
				this._eventsUpdated();
				// return true to accept the changes
				return true;
			},
		});
	}

	/**
	 * When the sequence has changed, all of the events need to be recreated
	 */
	private _eventsUpdated(): void {
		this._part.clear();
		this._rescheduleSequence(this._eventsArray, this._subdivision, this.startOffset);
		// update the loopEnd
		this.loopEnd = this.loopEnd;
	}

	/**
	 * reschedule all of the events that need to be rescheduled
	 */
	private _rescheduleSequence(sequence: any[], subdivision: Ticks, startOffset: Ticks): void {
		sequence.forEach((value, index) => {
			const eventOffset = index * (subdivision) + startOffset;
			if (isArray(value)) {
				this._rescheduleSequence(value, subdivision / value.length, eventOffset);
			} else {
				const startTime = new TicksClass(this.context, eventOffset, "i").toSeconds();
				this._part.add(startTime, value);
			}
		});
	}

	/**
	 *  Get the time of the index given the Sequence's subdivision
	 *  @param  index
	 *  @return The time of that index
	 *  @private
	 */
	private _indexTime(index: number): Seconds {
		return new TicksClass(this.context, index * (this._subdivision) + this.startOffset).toSeconds();
	}

	/**
	 * Clear all of the events
	 */
	clear(): this {
		this._part.clear();
		return this;
	}

	dispose(): this {
		super.dispose();
		this._part.dispose();
		return this;
	}

	///////////////////////////////////////////////////////////////////////////
	// PROXY CALLS
	///////////////////////////////////////////////////////////////////////////

	get loop(): boolean | number {
		return this._part.loop;
	}
	set loop(l) {
		if (this._part) {
			this._part.loop = l;
		}
	}

	/**
	 * The index at which the sequence should start looping
	 */
	get loopStart(): number {
		return this._loopStart;
	}
	set loopStart(index) {
		this._loopStart = index;
		if (this._part) {
			this._part.loopStart = this._indexTime(index);
		}
	}

	/**
	 * The index at which the sequence should end looping
	 */
	get loopEnd(): number {
		return this._loopEnd;
	}
	set loopEnd(index) {
		this._loopEnd = index;
		if (this._part) {
			if (index === 0) {
				this._part.loopEnd = this._indexTime(this._eventsArray.length);
			} else {
				this._part.loopEnd = this._indexTime(index);
			}
		}
	}

	get startOffset(): Ticks {
		return this._part.startOffset;
	}
	set startOffset(start) {
		if (this._part) {
			this._part.startOffset = start;
		}
	}

	get playbackRate(): Positive {
		return this._part.playbackRate;
	}
	set playbackRate(rate) {
		if (this._part) {
			this._part.playbackRate = rate;
		}
	}

	get probability(): NormalRange {
		return this._part.probability;
	}
	set probability(prob) {
		if (this._part) {
			this._part.probability = prob;
		}
	}

	get humanize(): boolean | Time {
		return this._part.humanize;
	}
	set humanize(variation) {
		if (this._part) {
			this._part.humanize = variation;
		}
	}

	/**
	 * The number of scheduled events
	 */
	get length(): number {
		return this._part.length;
	}
}
