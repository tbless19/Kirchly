import type { Problem } from "./solve";

const P = (
  title: string,
  type: Problem["type"],
  variant: string,
  values: Problem["values"],
  asks: [string, string][],
  notes = "",
): Problem => {
  const vals = { ...values };
  for (const [, key] of asks) if (!(key in vals)) vals[key] = null;
  return { title, type, variant, values: vals, asks: asks.map(([label, key]) => ({ label, key })), notes };
};

export const MOTION_EXAMPLES: Problem[] = [
  P("Car braking to a stop", "kinematics_1d", "horizontal", { v0: 20, v: 0, a: -5 }, [["Stopping distance", "d"], ["Stopping time", "t"]],
    "A car moving at 20 m/s brakes at 5 m/s²."),
  P("Ball dropped from a building", "kinematics_1d", "free_fall", { v0: 0, d: -45 }, [["Time to hit the ground", "t"], ["Impact velocity", "v"]],
    "Dropped from rest, 45 m above the ground."),
  {
    ...P("Pop fly (US units)", "projectile", "standard", { v0: 80 * 0.3048, theta: 70, h0: 4 * 0.3048 }, [["Maximum height", "H"], ["Hang time", "t"], ["Distance from home plate", "R"]],
      "Hit at 80 ft/s, 70° above horizontal, from 4 ft off the ground."),
    units: "imperial",
  },
  P("Soccer kick", "projectile", "standard", { v0: 20, theta: 35 }, [["Range", "R"], ["Maximum height", "H"], ["Time of flight", "t"]]),
  P("Thrown horizontally off a cliff", "projectile", "standard", { v0: 15, theta: 0, h0: 20 }, [["Time to land", "t"], ["Distance from the cliff", "R"], ["Landing speed", "vL"]]),
  P("Block sliding down a ramp", "incline", "down", { m: 10, theta: 30, mu: 0.2, v0: 0, d: 5 }, [["Acceleration", "a"], ["Time to reach the bottom", "t"], ["Speed at the bottom", "v"]]),
  P("Atwood machine", "pulley", "atwood", { m1: 2, m2: 3, v0: 0, t: 2 }, [["Acceleration", "a"], ["Rope tension", "Ft"], ["Distance moved in 2 s", "d"]]),
  P("Block on a table and a hanging mass", "pulley", "table", { m1: 4, m2: 2, mu: 0.25 }, [["Acceleration", "a"], ["Rope tension", "Ft"]]),
  P("Car on a flat curve", "circular", "flat_curve", { m: 1200, r: 50, v: 20 }, [["Minimum coefficient of friction", "mu"], ["Friction force needed", "Fc"]]),
  P("Top of a loop-the-loop", "circular", "vertical_top", { m: 0.5, r: 2, Ft: 0 }, [["Minimum speed at the top", "v"]],
    "At the minimum speed the track pushes with zero force at the top."),
  P("Space station orbit", "circular", "orbit", { M: 5.972e24, r: 6.771e6, m: 420000 }, [["Orbital speed", "v"], ["Orbital period", "Tp"]],
    "Orbit radius = Earth radius + 400 km."),
  P("Wheel spun by a rope", "rotation", "solid_disk", { m: 2, R: 0.3, w0: 0, F: 10, t: 3 }, [["Angular acceleration", "al"], ["Angular velocity after 3 s", "w"], ["Revolutions", "nrev"]],
    "A 10 N force pulls tangentially on the rim of a solid disk."),
  P("Roller coaster hill", "energy", "basic", { m: 500, h1: 30, v1: 2, h2: 10 }, [["Speed at the lower point", "v2"]]),
  P("Spring launcher with friction", "energy", "friction_spring", { m: 0.2, k: 400, x1: 0.1, v1: 0, h1: 0, h2: 0, Ff: 0.5, d: 1 }, [["Speed after 1 m", "v2"]]),
  P("Billiard balls (elastic)", "collision", "elastic", { m1: 0.17, m2: 0.17, u1: 2, u2: 0 }, [["Velocity of the cue ball after", "v1"], ["Velocity of the target ball after", "v2"]]),
  P("Railway cars couple together", "collision", "inelastic", { m1: 10000, u1: 3, m2: 8000, u2: 0 }, [["Speed after coupling", "v1"], ["Kinetic energy lost", "dKE"]]),
  P("Mass on a spring", "shm", "spring", { k: 200, m: 0.5, A: 0.1 }, [["Period", "Tp"], ["Maximum speed", "vmax"]]),
  P("Pendulum clock", "shm", "pendulum", { L: 0.994, th0: 8 }, [["Period", "Tp"]]),
];
