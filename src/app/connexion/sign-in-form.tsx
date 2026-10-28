"use client";

import { Button, PasswordInput, Text, TextInput } from "@mantine/core";
import { type KeyboardEvent, useActionState, useState } from "react";
import { type ConnectionState, signIn } from "./actions";
import { SIGN_IN } from "./fields";

const initialState: ConnectionState = { error: null, email: "" };

export function SignInForm() {
  const [state, action, inProgress] = useActionState(signIn, initialState);
  const [visible, setVisible] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <TextInput
        id="email"
        label="Adresse e-mail"
        name={SIGN_IN.name("email")}
        type="email"
        autoComplete="username"
        required
        withAsterisk={false}
        autoFocus
        defaultValue={state.email}
      />
      <PasswordInput
        id="password"
        label="Mot de passe"
        name={SIGN_IN.name("password")}
        autoComplete="current-password"
        required
        withAsterisk={false}
        visible={visible}
        onVisibilityChange={setVisible}
        // Reachable with Tab and named, a toggle (`aria-pressed` set by Mantine):
        // Mantine leaves the eye out of the keyboard order and toggles on Space only.
        visibilityToggleButtonProps={{
          tabIndex: 0,
          "aria-label": "Afficher le mot de passe",
          onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            setVisible((v) => !v);
          },
        }}
      />
      {state.error && (
        <Text role="alert" size="sm" c="red">
          {state.error}
        </Text>
      )}
      <Button type="submit" loading={inProgress}>
        Se connecter
      </Button>
    </form>
  );
}
